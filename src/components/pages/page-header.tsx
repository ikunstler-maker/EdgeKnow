"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { t } from "@/i18n";
import { ancestorsOf } from "@/lib/pages";
import { EmojiPicker } from "./emoji-picker";
import { usePages } from "./pages-provider";

const SAVE_DELAY_MS = 600;

// Breadcrumbs, icon and title of a page. Title edits are saved while typing
// (after a short pause) and on leaving the field; the sidebar updates instantly.
export function PageHeader({
  id,
  initialTitle,
  initialIcon,
  readOnly,
}: {
  id: string;
  initialTitle: string;
  initialIcon: string | null;
  readOnly: boolean;
}) {
  const { pages, rename, setIcon } = usePages();
  const node = pages.find((p) => p.id === id);
  const icon = node ? node.icon : initialIcon;
  const crumbs = ancestorsOf(pages, id).slice(0, -1);

  const title = node ? node.title : initialTitle;
  // While the field is focused it shows the user's draft; otherwise the latest saved
  // title (which may also change from the sidebar).
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? title;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);

  // Grow the title field with its text (Safari lacks CSS field-sizing).
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const save = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    const trimmed = next.trim();
    if (trimmed !== title) rename(id, trimmed);
  };

  return (
    <header>
      {crumbs.length > 0 && (
        <nav aria-label={t.pages.breadcrumbs} className="mb-4 flex flex-wrap items-center gap-1 text-sm text-muted">
          {crumbs.map((crumb) => (
            <span key={crumb.id} className="flex min-w-0 items-center gap-1">
              <Link href={`/p/${crumb.id}`} className="truncate hover:text-foreground hover:underline">
                {crumb.icon ? `${crumb.icon} ` : ""}
                {crumb.title || t.pages.untitled}
              </Link>
              <span aria-hidden="true">/</span>
            </span>
          ))}
        </nav>
      )}

      {readOnly ? (
        icon && <div className="text-5xl">{icon}</div>
      ) : (
        <button
          type="button"
          onClick={(event) => setPickerAnchor(pickerAnchor ? null : event.currentTarget)}
          className={
            icon
              ? "flex h-16 w-16 items-center justify-center rounded-lg text-5xl hover:bg-surface"
              : "min-h-11 rounded-md px-2 text-sm text-muted hover:bg-surface"
          }
          aria-label={icon ? t.pages.changeIcon : t.pages.addIcon}
          title={icon ? t.pages.changeIcon : t.pages.addIcon}
        >
          {icon ?? `☺ ${t.pages.addIcon}`}
        </button>
      )}

      {pickerAnchor && (
        <EmojiPicker
          anchor={pickerAnchor}
          current={icon}
          onPick={(value) => setIcon(id, value)}
          onClose={() => setPickerAnchor(null)}
        />
      )}

      {readOnly ? (
        <h1 className="mt-2 text-3xl font-bold md:text-4xl">{title || t.pages.untitled}</h1>
      ) : (
        <textarea
          ref={textarea}
          value={value}
          rows={1}
          maxLength={200}
          placeholder={t.pages.titlePlaceholder}
          aria-label={t.pages.titlePlaceholder}
          onFocus={() => setDraft(title)}
          onChange={(event) => {
            const next = event.target.value.replace(/\n/g, " ");
            setDraft(next);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => save(next), SAVE_DELAY_MS);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          onBlur={(event) => {
            save(event.currentTarget.value);
            setDraft(null);
          }}
          className="mt-2 w-full resize-none overflow-hidden bg-transparent text-3xl font-bold leading-tight outline-none placeholder:text-muted/60 md:text-4xl"
        />
      )}
    </header>
  );
}
