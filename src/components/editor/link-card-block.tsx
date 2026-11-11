"use client";

import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { t } from "@/i18n";
import type { LinkPreview } from "@/app/api/link-preview/route";
import { Icon } from "@/components/ui/icon";

const l = t.editor.linkCard;

// Only web links open from a card.
function safeHref(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  try {
    const response = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
    return response.ok ? ((await response.json()) as LinkPreview) : null;
  } catch {
    return null;
  }
}

type CardProps = { url: string; title: string; description: string; image: string; icon: string; siteName: string };

// A link shown as a card: a small preview (or the site's icon) on the left, the
// title and a short description on the right.
export const linkCardBlock = createReactBlockSpec(
  {
    type: "linkCard",
    propSchema: {
      url: { default: "" },
      title: { default: "" },
      description: { default: "" },
      image: { default: "" },
      icon: { default: "" },
      siteName: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <LinkCardView
        card={block.props}
        editable={editor.isEditable}
        onChange={(props) => editor.updateBlock(block, { props })}
      />
    ),
    toExternalHTML: ({ block }) => {
      const href = safeHref(block.props.url);
      return href ? <a href={href}>{block.props.title || href}</a> : <span />;
    },
  },
);

function LinkCardView({
  card,
  editable,
  onChange,
}: {
  card: CardProps;
  editable: boolean;
  onChange: (props: Partial<CardProps>) => void;
}) {
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [imageFailed, setImageFailed] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);
  const href = safeHref(card.url);

  const load = async (value: string) => {
    const url = value.trim();
    if (!/^https:\/\//i.test(url) || !safeHref(url)) return setState("error");
    setState("loading");
    const preview = await fetchLinkPreview(url);
    setImageFailed(false);
    setIconFailed(false);
    onChange(
      preview
        ? { url, title: preview.title, description: preview.description, image: preview.image, icon: preview.icon, siteName: preview.siteName }
        : { url, title: "", description: "", image: "", icon: "", siteName: new URL(url).hostname },
    );
    setState(preview ? "idle" : "error");
  };

  if (!href) {
    if (!editable) return <div className="ek-link-card ek-link-card-empty">{l.empty}</div>;
    return (
      <form
        contentEditable={false}
        className="ek-link-card ek-link-card-empty flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void load(draft);
        }}
      >
        <input
          type="url"
          inputMode="url"
          value={draft}
          placeholder={l.placeholder}
          aria-label={l.placeholder}
          onChange={(event) => {
            setDraft(event.target.value);
            setState("idle");
          }}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm"
        />
        <button type="submit" disabled={state === "loading" || !draft.trim()} className="min-h-11 rounded-md bg-accent px-3 text-sm font-medium text-white disabled:opacity-60 md:min-h-9">
          {state === "loading" ? l.loading : l.create}
        </button>
        {state === "error" && <p role="alert" className="w-full text-sm text-danger">{l.httpsOnly}</p>}
      </form>
    );
  }

  const host = (() => {
    try {
      return new URL(href).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const showImage = card.image && !imageFailed;

  return (
    <div contentEditable={false} className="ek-link-card">
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="ek-link-card-body" title={href}>
        <span className="ek-link-card-thumb" aria-hidden="true">
          {showImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- pictures from other sites, not ours to optimise
            <img src={card.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
          ) : card.icon && !iconFailed ? (
            // eslint-disable-next-line @next/next/no-img-element -- the site's own icon
            <img src={card.icon} alt="" className="ek-link-card-icon-large" loading="lazy" referrerPolicy="no-referrer" onError={() => setIconFailed(true)} />
          ) : (
            <Icon name="link" size={24} className="text-muted" />
          )}
        </span>
        <span className="ek-link-card-text">
          <span className="ek-link-card-title">{card.title || host}</span>
          {card.description && <span className="ek-link-card-description">{card.description}</span>}
          <span className="ek-link-card-site">
            {card.icon && !iconFailed && showImage && (
              // eslint-disable-next-line @next/next/no-img-element -- the site's own icon
              <img src={card.icon} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setIconFailed(true)} />
            )}
            {card.siteName || host}
          </span>
        </span>
      </a>
      {editable && (
        <div className="ek-link-card-actions">
          <button type="button" onClick={() => void load(href)} title={l.refresh} aria-label={l.refresh} disabled={state === "loading"}>
            <Icon name="refresh" />
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(href);
              onChange({ url: "", title: "", description: "", image: "", icon: "", siteName: "" });
            }}
            title={l.change}
            aria-label={l.change}
          >
            <Icon name="edit" />
          </button>
        </div>
      )}
    </div>
  );
}
