import type { CSSProperties } from "react";
import { dateLocale, t } from "@/i18n";
import { LIGHT_GRADIENTS, WISHLIST_GRADIENTS, patternImage, wishlistImageSrc, type WishlistData } from "@/lib/wishlist";
import type { WishlistGift } from "@/app/wishlist-actions";
import { Icon } from "@/components/ui/icon";
import { GiftBar } from "./gift-bar";

const w = t.wishlists;

export const birthdayLabel = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "long", year: "numeric" }).format(new Date(y, m - 1, d));
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

// Small floating sparks or confetti; still for people who turned motion off.
function Sparks({ kind, accent }: { kind: "sparkles" | "confetti"; accent: string }) {
  const bits = Array.from({ length: 18 }, (_, i) => i);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {bits.map((i) => {
        const left = (i * 37) % 100;
        const delay = (i * 0.7) % 6;
        const size = kind === "sparkles" ? 3 + (i % 3) * 2 : 6;
        const style: CSSProperties = {
          left: `${left}%`,
          top: kind === "sparkles" ? `${(i * 53) % 100}%` : "-10%",
          width: size,
          height: kind === "sparkles" ? size : size * 1.6,
          background: kind === "sparkles" ? "white" : [accent, "#fde047", "#f472b6", "#60a5fa"][i % 4],
          borderRadius: kind === "sparkles" ? 9999 : 2,
          animationDelay: `${delay}s`,
          opacity: kind === "sparkles" ? 0.8 : 0.9,
        };
        return <span key={i} className={`absolute ${kind === "sparkles" ? "motion-safe:animate-[wl-twinkle_3s_ease-in-out_infinite]" : "motion-safe:animate-[wl-fall_7s_linear_infinite]"}`} style={style} />;
      })}
    </div>
  );
}

// The wishlist page as everyone sees it: the gradient, the emoji pattern, the effect,
// the greeting and the wishes. The editor shows this same view live.
export function WishlistView({ title, data, shortId, ownerName, gifts }: {
  title: string;
  data: WishlistData;
  shortId: string;
  ownerName: string;
  // For colleagues: who gives what (never passed to the owner).
  gifts?: { wishlistId: string; list: WishlistGift[] };
}) {
  const { design } = data;
  const light = LIGHT_GRADIENTS.includes(design.gradient);
  const text = light ? "text-slate-900" : "text-white";
  const muted = light ? "text-slate-700" : "text-white/80";
  const card =
    design.effect === "glass"
      ? `backdrop-blur-md border ${light ? "bg-white/45 border-white/70" : "bg-white/12 border-white/25"}`
      : `border ${light ? "bg-white/80 border-white" : "bg-slate-950/35 border-white/15"}`;
  const glow: CSSProperties = design.effect === "glow" ? { boxShadow: `0 0 0 1px ${design.accent}55, 0 10px 40px -8px ${design.accent}` } : {};
  const background: CSSProperties = {
    backgroundImage: design.pattern ? `${patternImage(design.pattern)}, ${WISHLIST_GRADIENTS[design.gradient]}` : WISHLIST_GRADIENTS[design.gradient],
  };

  return (
    <div className={`relative isolate overflow-hidden rounded-3xl px-4 py-8 sm:px-8 sm:py-12 ${text}`} style={background} data-wishlist-view>
      <style>{`@keyframes wl-twinkle{0%,100%{opacity:.15;transform:scale(.6)}50%{opacity:.95;transform:scale(1.2)}}@keyframes wl-fall{0%{transform:translateY(0) rotate(0)}100%{transform:translateY(120vh) rotate(540deg)}}`}</style>
      {(design.effect === "sparkles" || design.effect === "confetti") && <Sparks kind={design.effect} accent={design.accent} />}
      <header className="relative mx-auto max-w-2xl text-center">
        <p className={`text-xs font-medium uppercase tracking-[0.2em] ${muted}`}>{w.forBirthday(birthdayLabel(data.birthday))}</p>
        <h1 className="mt-2 break-words text-3xl font-bold tracking-tight sm:text-4xl">{title || w.untitled(ownerName)}</h1>
        {data.intro && <p className={`mx-auto mt-3 max-w-xl whitespace-pre-line break-words text-base ${muted}`}>{data.intro}</p>}
      </header>
      {gifts && data.items.length > 0 && <p className={`relative mt-4 text-center text-xs ${muted}`}>{w.surprise}</p>}
      {data.items.length === 0 ? (
        <p className={`relative mt-8 text-center text-sm ${muted}`}>{w.empty}</p>
      ) : (
        <ul className="relative mx-auto mt-8 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2" data-wishlist-items>
          {data.items.map((item) => (
            <li key={item.id} className={`flex flex-col overflow-hidden rounded-2xl ${card}`} style={glow} data-wishlist-item>
              {item.image && (
                // eslint-disable-next-line @next/next/no-img-element -- a picture of the workspace's own storage, through its access check
                <img src={wishlistImageSrc(shortId, item.image)} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
              )}
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="min-w-0 break-words text-lg font-semibold leading-snug">{item.title}</h2>
                  {item.price && (
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: design.accent }}>
                      {item.price}
                    </span>
                  )}
                </div>
                {item.note && <p className={`whitespace-pre-line break-words text-sm ${muted}`}>{item.note}</p>}
                {!!item.links?.length && (
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    {item.links.map((link) => (
                      <a
                        key={link}
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className={`inline-flex min-h-11 max-w-full items-center gap-1 rounded-full px-3 text-xs font-medium md:min-h-8 ${light ? "bg-slate-900/10 hover:bg-slate-900/15" : "bg-white/15 hover:bg-white/25"}`}
                      >
                        <Icon name="external" size={12} />
                        <span className="truncate">{hostOf(link)}</span>
                      </a>
                    ))}
                  </div>
                )}
                {gifts && (
                  <GiftBar
                    shortId={shortId}
                    wishlistId={gifts.wishlistId}
                    item={item.id}
                    gifts={gifts.list.filter((g) => g.item === item.id)}
                    light={light}
                    accent={design.accent}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
