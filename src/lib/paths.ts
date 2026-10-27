// URL helpers shared by server and client code.

// Cookie with the last opened workspace, written by the proxy.
export const LAST_WORKSPACE_COOKIE = "ek_ws";
// Cookie holding where to go after the Google sign-in round trip.
export const NEXT_PATH_COOKIE = "ek_next";

export const workspacePath = (shortId: string, rest = "") => `/w/${shortId}${rest}`;
export const pagePath = (shortId: string, pageId: string) => `/w/${shortId}/p/${pageId}`;

// Only same-site relative paths, so a "next" value can't send people to another site.
export function safeNextPath(value: string | undefined | null): string | null {
  if (!value) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  return decoded.startsWith("/") && !decoded.startsWith("//") && !decoded.includes("\\")
    ? decoded
    : null;
}
