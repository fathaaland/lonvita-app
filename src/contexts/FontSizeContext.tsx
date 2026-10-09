"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

import {
  FONT_SCALE,
  FONT_SIZE_STORAGE_KEY,
  HIGH_CONTRAST_CLASS,
  HIGH_CONTRAST_STORAGE_KEY,
  isFontSize,
  type FontSize,
} from "@/lib/accessibilityPrefs";

interface Ctx {
  size: FontSize;
  setSize: (s: FontSize) => void;
  highContrast: boolean;
  setHighContrast: (v: boolean) => void;
}

const FontSizeContext = createContext<Ctx | null>(null);

/** localStorage throws outright when the browser blocks storage (cookies off, some private
 * modes) — and this provider wraps the whole app, so an uncaught read would take every page down
 * with it. Without storage the preferences just last until the tab closes. */
const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStored = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // See readStored.
  }
};

// US-H-07: these are read by every visitor, logged in or not, so this provider sits above
// AuthProvider (see providers.tsx) — a guest must be able to reach this before signing in.
// The first paint already carries the stored values (ACCESSIBILITY_PREFS_SCRIPT in the root
// layout); this keeps them in sync from there on.
export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [size, setSizeState] = useState<FontSize>(() => {
    if (typeof window === "undefined") return "normal";
    const v = readStored(FONT_SIZE_STORAGE_KEY);
    return isFontSize(v) ? v : "normal";
  });
  const [highContrast, setHighContrastState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return readStored(HIGH_CONTRAST_STORAGE_KEY) === "1";
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--font-scale", String(FONT_SCALE[size]));
    writeStored(FONT_SIZE_STORAGE_KEY, size);
  }, [size]);

  useEffect(() => {
    document.documentElement.classList.toggle(HIGH_CONTRAST_CLASS, highContrast);
    writeStored(HIGH_CONTRAST_STORAGE_KEY, highContrast ? "1" : "0");
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
