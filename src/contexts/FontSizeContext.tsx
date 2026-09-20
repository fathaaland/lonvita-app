"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type FontSize = "normal" | "large" | "xlarge";

const SCALE: Record<FontSize, number> = {
  normal: 1,
  large: 1.15,
  xlarge: 1.3,
};

const FONT_SIZE_STORAGE_KEY = "akce-zdar-font-size";
const HIGH_CONTRAST_STORAGE_KEY = "akce-zdar-high-contrast";

interface Ctx {
  size: FontSize;
  setSize: (s: FontSize) => void;
  highContrast: boolean;
  setHighContrast: (v: boolean) => void;
}

const FontSizeContext = createContext<Ctx | null>(null);

// US-H-07: these are read by every visitor, logged in or not, so this provider sits above
// AuthProvider (see providers.tsx) — a guest must be able to reach this before signing in.
export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [size, setSizeState] = useState<FontSize>(() => {
    if (typeof window === "undefined") return "normal";
    const v = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    return (v === "large" || v === "xlarge" || v === "normal") ? v : "normal";
  });
  const [highContrast, setHighContrastState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY) === "1";
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--font-scale", String(SCALE[size]));
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, size);
  }, [size]);

  useEffect(() => {
    document.documentElement.classList.toggle("high-contrast", highContrast);
    localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, highContrast ? "1" : "0");
  }, [highContrast]);

  return (
    <FontSizeContext.Provider value={{ size, setSize: setSizeState, highContrast, setHighContrast: setHighContrastState }}>
      {children}
    </FontSizeContext.Provider>
  );
}

export function useFontSize() {
  const ctx = useContext(FontSizeContext);
  if (!ctx) throw new Error("useFontSize must be used within FontSizeProvider");
  return ctx;
}
