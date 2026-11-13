// How other services point at a Vault file (VAULT-3): only the file's id is kept; what
// shows is read with the viewer's own access every time.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The file in Vault (its folder opens with the file marked).
export const vaultFileHref = (shortId: string, id: string) => `/w/${shortId}/files?file=${id}`;

// The id of a Vault file a link points at, when it is this workspace's (and, for a full
// address, this site's): "/w/<id>/files?file=<uuid>".
export function vaultFileIdOf(url: string, shortId: string, host?: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, "https://local.invalid");
  } catch {
    return null;
  }
  if (host && parsed.host !== "local.invalid" && parsed.host !== host) return null;
  if (parsed.pathname.replace(/\/$/, "") !== `/w/${shortId}/files`) return null;
  const id = parsed.searchParams.get("file") ?? "";
  return UUID.test(id) ? id : null;
}
