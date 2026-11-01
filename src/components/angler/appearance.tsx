"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// The angler fish in the sidebar and its lure (the feedback button): shown or
// not, per person (Profile → Appearance). Changes apply at once and are saved
// to the profile in the background.
export type LureMode = "bright" | "subtle" | "hidden";
export type Appearance = { showMascot: boolean; lure: LureMode };

const AppearanceContext = createContext<{ appearance: Appearance; setAppearance: (next: Appearance) => void }>({
  appearance: { showMascot: true, lure: "bright" },
  setAppearance: () => {},
});

export function AppearanceProvider({ initial, children }: { initial: Appearance; children: ReactNode }) {
  const [appearance, setAppearance] = useState(initial);
  return <AppearanceContext.Provider value={{ appearance, setAppearance }}>{children}</AppearanceContext.Provider>;
}

export const useAppearance = () => useContext(AppearanceContext);
