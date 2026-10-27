"use client";

import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { t } from "@/i18n";
import {
  parseYouTubeUrl,
  youTubeEmbedUrl,
  youTubeThumbnailUrl,
  youTubeWatchUrl,
} from "@/lib/youtube";
import type { YouTubeInfo } from "@/app/api/youtube/route";

export async function fetchYouTubeInfo(url: string): Promise<YouTubeInfo> {
  try {
    const response = await fetch(`/api/youtube?url=${encodeURIComponent(url)}`);
    if (response.ok) return (await response.json()) as YouTubeInfo;
  } catch {
    // Offline or blocked: the card falls back to the link itself.
  }
  return { title: null, author: null, thumbnail: null };
}

type YouTubeProps = { url: string; title: string; author: string };

type YouTubeViewProps = {
  props: YouTubeProps;
  editable: boolean;
  onEmbed: (props: YouTubeProps) => void;
};

// A YouTube video or playlist: a card with cover, title and channel; clicking
// it starts the player. Only youtube-nocookie.com is ever embedded, and only
// for a link that parses as YouTube — nothing else from the document reaches an iframe.
export const youTubeBlock = createReactBlockSpec(
  {
    type: "youtube",
    propSchema: {
      url: { default: "" },
      title: { default: "" },
      author: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <YouTubeView
        props={block.props}
        editable={editor.isEditable}
        onEmbed={(props) => editor.updateBlock(block, { props })}
      />
    ),
  },
);

function YouTubeView({ props, editable, onEmbed }: YouTubeViewProps) {
  const [playing, setPlaying] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);
  const ref = parseYouTubeUrl(props.url);

  if (!ref) {
    if (!editable) return <div className="ek-youtube-empty" />;
    return (
      <form
        className="ek-youtube-form"
        contentEditable={false}
        onSubmit={async (event) => {
          event.preventDefault();
          const parsed = parseYouTubeUrl(draft);
          if (!parsed) {
            setError(true);
            return;
          }
          const info = await fetchYouTubeInfo(draft);
          onEmbed({ url: youTubeWatchUrl(parsed), title: info.title ?? "", author: info.author ?? "" });
        }}
      >
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(false);
          }}
          placeholder={t.editor.youtube.prompt}
          aria-label={t.editor.youtube.prompt}
          inputMode="url"
        />
        <button type="submit">{t.editor.youtube.embed}</button>
        {error && <p role="alert">{t.editor.youtube.invalid}</p>}
      </form>
    );
  }

  const title = props.title || t.editor.youtube.untitled;

  if (playing) {
    return (
      <div className="ek-youtube" contentEditable={false}>
        <iframe
          src={youTubeEmbedUrl(ref)}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
    );
  }

  const thumbnail = youTubeThumbnailUrl(ref);
  return (
    <div className="ek-youtube" contentEditable={false}>
      <button
        type="button"
        className="ek-youtube-card"
        onClick={() => setPlaying(true)}
        aria-label={`${t.editor.youtube.play}: ${title}`}
      >
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- external YouTube cover, not optimisable
          <img src={thumbnail} alt="" loading="lazy" />
        ) : (
          <span className="ek-youtube-playlist">{t.editor.youtube.playlist}</span>
        )}
        <span className="ek-youtube-play" aria-hidden="true">
          ▶
        </span>
      </button>
      <div className="ek-youtube-meta">
        <span className="ek-youtube-title">{title}</span>
        {props.author && <span className="ek-youtube-author">{props.author}</span>}
        <a href={youTubeWatchUrl(ref)} target="_blank" rel="noopener noreferrer">
          {t.editor.youtube.openOnYouTube}
        </a>
      </div>
    </div>
  );
}
