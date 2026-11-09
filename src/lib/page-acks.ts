// Confirmations of reading on wiki pages (decision 2027-01-14).
export type AckLabel = "read" | "accept" | "agree";
export const ACK_LABELS: AckLabel[] = ["read", "accept", "agree"];

// What the page shows about its confirmation.
export type PageAck = {
  label: AckLabel;
  revision: number;
  editing: boolean;
  groups: string[];
  // When the current reader signed the current revision.
  signedAt: string | null;
  canManage: boolean;
};

export type AckPerson = { user_id: string; name: string | null; email: string | null };
export type AckRevision = { revision: number; label: AckLabel; content_hash: string; published_at: string };

// A frozen page can't be edited by anyone until a new revision is started.
export const isFrozen = (ack: PageAck | null) => Boolean(ack && !ack.editing);

export const formatAckDate = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale === "en" ? "en-GB" : "uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// CSV of a revision's signatures (a deleted account shows its id instead of email).
export function ackCsv(rows: (AckPerson & { signed_at: string })[], deleted: string, headers: [string, string, string]): string {
  const cell = (raw: string) => {
    // No formulas when opened in a spreadsheet.
    const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return /[",\n;]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
  };
  const lines = rows.map((r) => [r.name ?? (r.email ? "" : deleted), r.email ?? r.user_id, r.signed_at].map(cell).join(","));
  return [headers.map(cell).join(","), ...lines].join("\n");
}
