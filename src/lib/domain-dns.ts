import "server-only";
import { readFileSync } from "node:fs";
import { resolveTxt } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";

// Proving a domain through DNS: the workspace admin publishes a TXT record
// `_edgeknow.<domain>` = `edgeknow-verify=<token>` (or the same value on the
// domain itself), and the server looks it up.
//
// For automated tests DNS_FAKE_FILE points to a JSON map of names to TXT values.

export const recordName = (domain: string) => `_edgeknow.${domain}`;
export const recordValue = (token: string) => `edgeknow-verify=${token}`;

async function txt(name: string): Promise<string[]> {
  const fake = process.env.DNS_FAKE_FILE;
  if (fake && !process.env.VERCEL) {
    try {
      const map = JSON.parse(readFileSync(fake, "utf8")) as Record<string, string[]>;
      return map[name] ?? [];
    } catch {
      return [];
    }
  }
  try {
    return (await resolveTxt(name)).map((parts) => parts.join(""));
  } catch {
    // No such name, no TXT records, or DNS unreachable: not found either way.
    return [];
  }
}

export async function hasRecord(domain: string, token: string) {
  const expected = recordValue(token);
  const [own, root] = await Promise.all([txt(recordName(domain)), txt(domain)]);
  return [...own, ...root].some((value) => value.trim() === expected);
}

// Weekly: domains proven through DNS are looked up again; a missing record is
// only reported to the admins (people who joined stay, and so does the domain).
export async function recheckDomains(admin: SupabaseClient) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data } = await admin
    .from("workspace_domains")
    .select("domain, dns_token, dns_missing_since")
    .eq("method", "dns")
    .or(`dns_checked_at.is.null,dns_checked_at.lt.${weekAgo}`)
    .limit(200);
  let missing = 0;
  for (const row of data ?? []) {
    const there = row.dns_token ? await hasRecord(row.domain, row.dns_token) : false;
    if (!there) missing += 1;
    await admin
      .from("workspace_domains")
      .update({
        dns_checked_at: new Date().toISOString(),
        dns_missing_since: there ? null : (row.dns_missing_since ?? new Date().toISOString()),
      })
      .eq("domain", row.domain);
  }
  return { checked: data?.length ?? 0, missing };
}
