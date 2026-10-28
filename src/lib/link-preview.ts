import "server-only";

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { isIP } from "node:net";

// Reads the title, description, image and icon of a public web page for a link
// card. The server fetches someone else's page, so it must never be tricked into
// reaching internal addresses: https only, port 443, every resolved address
// checked at connection time (no DNS rebinding), a few redirects at most, short
// timeouts and a size cap.

export type LinkPreview = {
  url: string;
  title: string;
  description: string;
  image: string;
  icon: string;
  siteName: string;
};

const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

function isPrivateV4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) return !isPrivateV4(ip);
  if (isIP(ip) !== 6) return false;
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return !isPrivateV4(mapped[1]);
  return !(
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb") ||
    v6.startsWith("ff") ||
    v6.startsWith("64:ff9b") ||
    v6.startsWith("2001:db8")
  );
}

// Used as the socket's DNS lookup: the address checked is the one connected to.
function safeLookup(
  hostname: string,
  options: object,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) {
  dnsLookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
      return callback(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }), "");
    }
    if ((options as { all?: boolean }).all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export function checkUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password) return null;
  // Literal IP addresses must be public too (the lookup isn't used for them).
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) return null;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return null;
  return url;
}

function fetchOnce(url: URL): Promise<{ status: number; location?: string; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        lookup: safeLookup as never,
        timeout: TIMEOUT_MS,
        headers: {
          "User-Agent": "EdgeKnowLinkPreview/1.0 (+link cards)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "uk,en;q=0.8",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const type = String(res.headers["content-type"] ?? "");
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location, type, body: "" });
        }
        if (!type.includes("html")) {
          res.resume();
          return resolve({ status, type, body: "" });
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          // Metadata lives in <head>: stop reading after the cap.
          if (size > MAX_BYTES) {
            res.destroy();
            resolve({ status, type, body: Buffer.concat(chunks).toString("utf8") });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, type, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

const decode = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

function attr(tag: string, name: string) {
  return tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(2).find((v) => v !== undefined) ?? "";
}

// Absolute https URLs only; anything else is dropped.
function absolute(value: string, base: URL) {
  if (!value) return "";
  try {
    const url = new URL(decode(value), base);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function parseMeta(html: string, base: URL): Omit<LinkPreview, "url"> {
  const head = html.slice(0, MAX_BYTES).split(/<\/head>/i)[0];
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, "property") || attr(tag, "name")).toLowerCase();
    const content = attr(tag, "content");
    if (key && content && !meta.has(key)) meta.set(key, content);
  }
  let icon = "";
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, "rel").toLowerCase();
    if (/(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(rel)) {
      icon = absolute(attr(tag, "href"), base);
      if (rel.includes("apple-touch-icon")) break;
    }
  }
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const pick = (...keys: string[]) => keys.map((k) => meta.get(k)).find(Boolean) ?? "";
  return {
    title: decode(pick("og:title", "twitter:title") || titleTag).slice(0, 200),
    description: decode(pick("og:description", "twitter:description", "description")).slice(0, 300),
    image: absolute(pick("og:image:secure_url", "og:image", "twitter:image"), base),
    icon: icon || absolute("/favicon.ico", base),
    siteName: decode(pick("og:site_name") || base.hostname.replace(/^www\./, "")).slice(0, 80),
  };
}

const cache = new Map<string, { at: number; value: LinkPreview }>();
const CACHE_MS = 60 * 60 * 1000;

export async function fetchLinkPreview(raw: string): Promise<LinkPreview | null> {
  let url = checkUrl(raw);
  if (!url) return null;
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchOnce(url).catch(() => null);
    if (!res) return null;
    if (res.location) {
      const next = checkUrl(new URL(res.location, url).toString());
      if (!next) return null;
      url = next;
      continue;
    }
    if (res.status >= 400) return null;
    const value: LinkPreview = res.body
      ? { url: key, ...parseMeta(res.body, url) }
      : { url: key, title: "", description: "", image: "", icon: absolute("/favicon.ico", url), siteName: url.hostname };
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: Date.now(), value });
    return value;
  }
  return null;
}
