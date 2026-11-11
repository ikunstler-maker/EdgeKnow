// Company apps (Obriy, step O-1): what one app keeps in its service object's data.
// The database checks the same rules again (public.app_data_ok).
export type AppData = {
  url: string;
  // An https picture address read from the app's site, or an uploaded picture (object file id).
  logo?: string;
  logoFile?: string;
  category?: string;
  description?: string;
};

export const APP_LIMITS = { title: 200, url: 2000, category: 60, description: 500, logoBytes: 2 * 1024 * 1024 } as const;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// Only web addresses the browser opens as pages: http or https, no spaces, no
// credentials. Anything else (javascript:, data:, file:…) is refused.
export function cleanAppUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > APP_LIMITS.url || /\s/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || !url.hostname) return null;
  return url.toString();
}

export function cleanLogoUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const url = cleanAppUrl(raw);
  return url && url.startsWith("https://") ? url : undefined;
}

export function readApp(data: unknown): AppData {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const file = text(d.logoFile, 36);
  return {
    url: cleanAppUrl(text(d.url, APP_LIMITS.url)) ?? "",
    logo: cleanLogoUrl(text(d.logo, APP_LIMITS.url)),
    logoFile: /^[0-9a-f-]{36}$/.test(file) ? file : undefined,
    category: text(d.category, APP_LIMITS.category) || undefined,
    description: text(d.description, APP_LIMITS.description) || undefined,
  };
}

// What is written: empty fields left out.
export function appData(input: AppData): AppData {
  const out: AppData = { url: input.url };
  if (input.logoFile) out.logoFile = input.logoFile;
  else if (input.logo) out.logo = input.logo;
  if (input.category?.trim()) out.category = input.category.trim().slice(0, APP_LIMITS.category);
  if (input.description?.trim()) out.description = input.description.trim().slice(0, APP_LIMITS.description);
  return out;
}

export const appLogoSrc = (shortId: string, app: AppData) =>
  app.logoFile ? `/api/apps/logo/${app.logoFile}?ws=${shortId}` : (app.logo ?? null);
