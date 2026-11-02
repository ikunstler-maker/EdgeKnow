// The canvas's fonts come from this site (copied at build time by
// scripts/copy-excalidraw-assets.mjs), not from a third-party CDN.
if (typeof window !== "undefined") {
  (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";
}
export {};
