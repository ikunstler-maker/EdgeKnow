"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { ANGLER_GAME_EVENT } from "./angler-guide";

// The game's code loads only when someone actually opens it (five quick clicks on the fish).
const DepthGame = dynamic(() => import("./depth-game").then((m) => m.DepthGame), { ssr: false });

export function AnglerGame() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(ANGLER_GAME_EVENT, show);
    return () => window.removeEventListener(ANGLER_GAME_EVENT, show);
  }, []);
  return open ? <DepthGame onClose={() => setOpen(false)} /> : null;
}
