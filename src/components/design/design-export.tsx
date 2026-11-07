"use client";

import type { SlideNode } from "@/lib/slides";

export type ExportFormat = "png" | "svg" | "pdf";

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 80) || "frame";

async function toDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error("image");
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// A standalone SVG of one frame, cut out of the canvas: same drawing, images inlined,
// live embeds (iframes) left out because a file can't hold them.
export async function frameSvg(svg: SVGSVGElement, frame: SlideNode): Promise<string> {
  const source = svg.querySelector(`g[data-node-id="${CSS.escape(frame.id)}"]`);
  if (!source) throw new Error("frame");
  const clone = source.cloneNode(true) as SVGGElement;
  clone.querySelectorAll("iframe, textarea, [data-text-editor]").forEach((el) => el.closest("foreignObject")?.remove());
  await Promise.all(
    Array.from(clone.querySelectorAll("image")).map(async (img) => {
      const href = img.getAttribute("href") ?? img.getAttribute("xlink:href");
      if (!href || href.startsWith("data:")) return;
      try {
        img.setAttribute("href", await toDataUrl(href));
      } catch {
        img.remove();
      }
    }),
  );
  const doc = document.implementation.createDocument("http://www.w3.org/2000/svg", "svg", null);
  const root = doc.documentElement;
  root.setAttribute("viewBox", `${frame.x} ${frame.y} ${frame.width} ${frame.height}`);
  root.setAttribute("width", String(Math.round(frame.width)));
  root.setAttribute("height", String(Math.round(frame.height)));
  root.appendChild(doc.importNode(clone, true));
  return new XMLSerializer().serializeToString(root);
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function svgToPng(markup: string, width: number, height: number, scale: number): Promise<Blob> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png"));
}

export async function exportFrame(svg: SVGSVGElement, frame: SlideNode, format: ExportFormat): Promise<void> {
  const markup = await frameSvg(svg, frame);
  const name = safeName(frame.name);
  if (format === "svg") return download(new Blob([markup], { type: "image/svg+xml" }), `${name}.svg`);
  if (format === "png") return download(await svgToPng(markup, frame.width, frame.height, 2), `${name}.png`);
  // PDF: the browser's own "Save as PDF" in print, one page the size of the frame.
  const w = window.open("", "_blank");
  if (!w) throw new Error("popup");
  const pdoc = w.document;
  pdoc.title = name;
  const style = pdoc.createElement("style");
  style.textContent = `@page{size:${Math.round(frame.width)}px ${Math.round(frame.height)}px;margin:0}html,body{margin:0;padding:0}svg{display:block}`;
  pdoc.head.appendChild(style);
  pdoc.body.innerHTML = markup;
  w.setTimeout(() => {
    w.focus();
    w.print();
  }, 300);
}
