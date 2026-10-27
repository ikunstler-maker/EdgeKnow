"use client";

import { useState } from "react";
import { t } from "@/i18n";
import { Popover } from "@/components/ui/popover";

// A short curated set; anything else can be pasted into the input below.
const EMOJIS = [
  "📄", "📝", "📘", "📗", "📕", "📙", "📚", "📌", "📎", "🗂️",
  "📁", "🗃️", "📊", "📈", "📉", "🧾", "📅", "⏰", "✅", "☑️",
  "❗", "❓", "💡", "🔥", "⭐", "🎯", "🚀", "🏁", "🧭", "🗺️",
  "🎨", "🖌️", "🎬", "🎥", "📷", "🖼️", "🎵", "🎮", "🕹️", "📣",
  "💬", "🗣️", "👥", "🤝", "🧑‍💻", "👀", "🧠", "❤️", "💰", "💳",
  "🛒", "📦", "🏷️", "🔧", "⚙️", "🛠️", "🧪", "🐞", "🔒", "🔑",
  "🌐", "📱", "💻", "🖥️", "☁️", "⚡", "🌱", "🌍", "🏠", "🏢",
  "✈️", "🚗", "☕", "🍕", "🎉", "🎁", "🏆", "📍", "🔖", "🧩",
];

export function EmojiPicker({
  anchor,
  current,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  current: string | null;
  onPick: (icon: string | null) => void;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState("");

  const pick = (icon: string | null) => {
    onPick(icon);
    onClose();
  };

  return (
    <Popover anchor={anchor} onClose={onClose} width={320}>
      <p className="px-2 pt-1 text-xs font-medium text-muted">{t.emoji.title}</p>
      <div className="grid grid-cols-8 gap-0.5 p-1">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => pick(emoji)}
            className={`flex aspect-square items-center justify-center rounded-md text-xl hover:bg-surface ${
              emoji === current ? "bg-surface" : ""
            }`}
          >
            {emoji}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2 border-t border-border p-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = custom.trim();
          if (value) pick(value);
        }}
      >
        <input
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          maxLength={16}
          placeholder={t.emoji.custom}
          aria-label={t.emoji.custom}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-base"
        />
        <button type="submit" className="min-h-11 rounded-md bg-accent px-3 text-sm text-white">
          {t.emoji.apply}
        </button>
      </form>
      {current && (
        <button
          type="button"
          onClick={() => pick(null)}
          className="min-h-11 w-full rounded-md px-3 text-left text-sm text-danger hover:bg-surface"
        >
          {t.emoji.remove}
        </button>
      )}
    </Popover>
  );
}
