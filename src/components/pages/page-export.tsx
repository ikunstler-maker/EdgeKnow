"use client";

import { useState } from "react";
import { t } from "@/i18n";
import { resolveAttachmentUrl, isExternalImageUrl } from "@/lib/attachments";
import { pageToMarkdown, type MdData } from "@/lib/page-markdown";
import { pagePath } from "@/lib/paths";
import { makeZip, type ZipEntry } from "@/lib/zip";
import { pageExport } from "@/app/page-export-actions";
import { Popover } from "@/components/ui/popover";
import { ProBadge } from "@/components/ui/pro-badge";
import { usePages } from "./pages-provider";
import { Icon } from "@/components/ui/icon";

const x = t.pageExport;
const PRO_FORMATS = [x.json, x.csv, x.docx, x.html];
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
};

const buttonClass = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-hover px-3 text-[13px] font-medium hover:border-border-strong disabled:opacity-50 md:h-8 md:min-h-0";
const itemClass = "flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm md:min-h-9";

// A file name from the page title: letters of any language, digits, spaces and dashes.
const fileName = (title: string) => title.replace(/[^\p{L}\p{N} _-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "page";

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// "Експорт": copy the page link, PDF and Markdown (Free), the PRO formats shown greyed out.
export function PageExportButton({ pageId }: { pageId: string }) {
  const { workspace, pages } = usePages();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${pagePath(workspace.shortId, pageId)}`);
      setStatus(x.copied);
    } catch {
      setStatus(x.copyFailed);
    }
  };

  const openPdf = () => {
    window.open(`${pagePath(workspace.shortId, pageId)}/print`, "_blank", "noopener");
    setAnchor(null);
  };

  const exportMarkdown = async () => {
    setBusy(true);
    setStatus(x.working);
    try {
      const page = await pageExport(workspace.shortId, pageId);
      if (!page) throw new Error("no page");
      // Our own files go into the archive next to the text; pictures from other sites stay links.
      const local = new Map<string, string>();
      const entries: ZipEntry[] = [];
      let skipped = 0;
      for (const url of page.files) {
        if (isExternalImageUrl(url) || local.has(url)) continue;
        const source = await resolveAttachmentUrl(url);
        if (!source) continue;
        try {
          const response = await fetch(source, { credentials: "same-origin" });
          const bytes = response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
          if (!bytes || bytes.length > MAX_FILE_BYTES) throw new Error("file");
          const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
          const name = `files/${String(entries.length + 1).padStart(2, "0")}.${EXTENSIONS[type] ?? "bin"}`;
          entries.push({ name, data: bytes });
          local.set(url, name);
        } catch {
          skipped += 1;
        }
      }
      const data: MdData = {
        base: `${window.location.origin}/w/${workspace.shortId}`,
        pageId,
        pages: pages.map((p) => ({ id: p.id, title: p.title, icon: p.icon, parentId: p.parentId })),
        sheets: page.sheets,
        boards: page.boards,
        nodes: page.nodes,
        surveys: page.surveys,
        taskLists: page.taskLists,
        taskChips: page.taskChips,
        image: (url) => local.get(url) ?? (isExternalImageUrl(url) ? url : null),
      };
      const markdown = pageToMarkdown(page.title, page.icon, page.content, data, x.md);
      const name = fileName(page.title || x.md.untitled);
      if (entries.length) {
        const zip = makeZip([{ name: `${name}.md`, data: new TextEncoder().encode(markdown) }, ...entries]);
        download(`${name}.zip`, new Blob([zip.buffer as ArrayBuffer], { type: "application/zip" }));
      } else {
        download(`${name}.md`, new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
      }
      setStatus(skipped ? x.imagesSkipped(skipped) : null);
      if (!skipped) setAnchor(null);
    } catch {
      setStatus(x.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          setStatus(null);
          setAnchor(anchor ? null : event.currentTarget);
        }}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        className={buttonClass}
        data-page-export
      >
        {x.button}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={260}>
          <div role="menu" aria-label={x.menu}>
            <button type="button" role="menuitem" onClick={copyLink} className={`${itemClass} hover:bg-surface`} data-export-copy-link>
              <Icon name="link" className="mr-1 inline" />
              {x.copyLink}
            </button>
            <p className="px-3 pb-1 text-xs text-muted">{x.linkHint}</p>
            <p className="mt-1 border-t border-border px-3 pb-1 pt-2 text-xs font-medium text-muted">{x.exportHeading}</p>
            <button type="button" role="menuitem" onClick={openPdf} disabled={busy} className={`${itemClass} hover:bg-surface disabled:opacity-60`} data-export-format="pdf">
              <Icon name="file-text" className="mr-1 inline" />
              {x.pdf}
            </button>
            <button type="button" role="menuitem" onClick={exportMarkdown} disabled={busy} className={`${itemClass} hover:bg-surface disabled:opacity-60`} data-export-format="md">
              <Icon name="file-text" className="mr-1 inline" />
              {x.markdown}
            </button>
            {PRO_FORMATS.map((format) => (
              <button key={format} type="button" role="menuitem" disabled aria-disabled="true" title={x.proHint} className={`${itemClass} cursor-not-allowed text-muted`} data-export-format={format.toLowerCase()}>
                <span className="opacity-60">{format}</span>
                <span className="flex-1" />
                <ProBadge />
              </button>
            ))}
            <p className="px-3 pb-2 pt-1 text-xs text-muted">{x.proHint}</p>
            {status && (
              <p role="status" className="border-t border-border px-3 py-2 text-sm">
                {status}
              </p>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}
