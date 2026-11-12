// A wishlist as the database keeps it (service object "wishlists"), and its look.

export const WISHLIST_GRADIENTS = {
  aurora: "linear-gradient(135deg, #7c3aed 0%, #2563eb 45%, #06b6d4 100%)",
  sunset: "linear-gradient(135deg, #f97316 0%, #ec4899 55%, #8b5cf6 100%)",
  ocean: "linear-gradient(160deg, #0ea5e9 0%, #2563eb 50%, #1e3a8a 100%)",
  candy: "linear-gradient(135deg, #f472b6 0%, #c084fc 50%, #60a5fa 100%)",
  forest: "linear-gradient(150deg, #10b981 0%, #059669 45%, #134e4a 100%)",
  dusk: "linear-gradient(160deg, #1e1b4b 0%, #6d28d9 55%, #db2777 100%)",
  peach: "linear-gradient(135deg, #fda4af 0%, #fdba74 50%, #fde68a 100%)",
  mint: "linear-gradient(135deg, #a7f3d0 0%, #5eead4 45%, #38bdf8 100%)",
  galaxy: "radial-gradient(120% 90% at 20% 10%, #8b5cf6 0%, #312e81 45%, #0f172a 100%)",
  gold: "linear-gradient(135deg, #fde68a 0%, #f59e0b 50%, #b45309 100%)",
} as const;
export type WishlistGradient = keyof typeof WISHLIST_GRADIENTS;
// Light gradients carry dark text.
export const LIGHT_GRADIENTS: WishlistGradient[] = ["peach", "mint", "gold"];

export const WISHLIST_EFFECTS = ["none", "glass", "glow", "sparkles", "confetti"] as const;
export type WishlistEffect = (typeof WISHLIST_EFFECTS)[number];

export type WishlistPattern = { emoji: string; size: number; density: number; opacity: number; angle: number };
export type WishlistDesign = { gradient: WishlistGradient; accent: string; effect: WishlistEffect; pattern: WishlistPattern | null };
export type WishlistItem = { id: string; title: string; note?: string; price?: string; links?: string[]; image?: string | null };
export type WishlistData = { birthday: string; published: boolean; intro: string; design: WishlistDesign; items: WishlistItem[] };
export type Wishlist = { id: string; title: string; version: number; ownerId: string; data: WishlistData };

export const WISHLIST_LIMITS = { items: 50, links: 3, title: 200, listTitle: 200, note: 1000, price: 40, intro: 2000 };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clampNum = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

// Reads stored data defensively; anything odd falls back to a plain default.
export function readWishlist(raw: unknown): WishlistData {
  const d = isObject(raw) ? raw : {};
  const design = isObject(d.design) ? d.design : {};
  const p = isObject(design.pattern) ? design.pattern : null;
  const gradient = typeof design.gradient === "string" && design.gradient in WISHLIST_GRADIENTS ? (design.gradient as WishlistGradient) : "aurora";
  const effect = WISHLIST_EFFECTS.includes(design.effect as WishlistEffect) ? (design.effect as WishlistEffect) : "glass";
  return {
    birthday: typeof d.birthday === "string" ? d.birthday : "",
    published: d.published === true,
    intro: typeof d.intro === "string" ? d.intro : "",
    design: {
      gradient,
      accent: typeof design.accent === "string" && /^#[0-9a-f]{6}$/.test(design.accent) ? design.accent : "#7c3aed",
      effect,
      pattern:
        p && typeof p.emoji === "string" && p.emoji
          ? { emoji: p.emoji, size: clampNum(p.size, 16, 96, 32), density: clampNum(p.density, 1, 5, 3), opacity: clampNum(p.opacity, 0.02, 0.4, 0.12), angle: clampNum(p.angle, -45, 45, -15) }
          : null,
    },
    items: Array.isArray(d.items)
      ? d.items.filter(isObject).map((i) => ({
          id: String(i.id ?? ""),
          title: String(i.title ?? ""),
          note: typeof i.note === "string" ? i.note : "",
          price: typeof i.price === "string" ? i.price : "",
          links: Array.isArray(i.links) ? i.links.filter((l): l is string => typeof l === "string") : [],
          image: typeof i.image === "string" ? i.image : null,
        }))
      : [],
  };
}

export const isWebLink = (value: string) => /^https?:\/\/\S+$/i.test(value.trim()) && value.length <= 2000;

// A tile of the person's emoji, repeated over the page as a light background pattern.
export function patternImage(p: WishlistPattern): string {
  const gap = p.size * (3.2 - p.density * 0.5);
  const tile = Math.round(p.size + gap);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}" viewBox="0 0 ${tile} ${tile}">` +
    `<text x="50%" y="50%" font-size="${p.size}" text-anchor="middle" dominant-baseline="central" opacity="${p.opacity}" ` +
    `transform="rotate(${p.angle} ${tile / 2} ${tile / 2})">${escapeXml(p.emoji)}</text></svg>`;
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

function escapeXml(text: string) {
  return text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

export const wishlistImageSrc = (shortId: string, fileId: string) => `/api/boards/files/${fileId}?ws=${shortId}`;
