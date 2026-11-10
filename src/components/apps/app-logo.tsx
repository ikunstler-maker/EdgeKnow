"use client";

import { useState } from "react";
import { brandGradients } from "@/lib/services";

// A company app's logo: the uploaded picture or the one read from its site; the
// app's first letter on the service's gradient when there is none or it fails.
export function AppLogo({ src, name, size = 56 }: { src: string | null; name: string; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  const style = { width: size, height: size };
  if (src && failed !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- outside or private pictures, shown as they are
      <img
        src={src}
        alt=""
        style={style}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setFailed(src)}
        className="shrink-0 rounded-xl border border-border bg-white object-contain p-1"
      />
    );
  }
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span aria-hidden="true" style={{ ...style, backgroundImage: brandGradients("apps").dark }} className="flex shrink-0 items-center justify-center rounded-xl text-xl font-semibold text-white">
      {letter}
    </span>
  );
}
