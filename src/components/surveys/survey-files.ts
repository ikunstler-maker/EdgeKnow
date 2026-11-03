// Files in survey answers (step О3): the kinds and size the database accepts
// (as for task files), and sending one to the server, which stores it.

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const FILE_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx",
].join(",");

// Some systems give no type for .csv or .docx: it is worked out from the name.
const BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  txt: "text/plain",
  pdf: "application/pdf",
  zip: "application/zip",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export async function uploadSurveyFile(url: string, file: File): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const type = file.type || BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream";
  const response = await fetch(`${url}&name=${encodeURIComponent(file.name.slice(0, 200))}`, { method: "POST", headers: { "Content-Type": type }, body: file });
  const result = (await response.json().catch(() => null)) as { ok?: boolean; id?: string; error?: string } | null;
  return result?.ok && result.id ? { ok: true, id: result.id } : { ok: false, error: result?.error ?? "upload_failed" };
}
