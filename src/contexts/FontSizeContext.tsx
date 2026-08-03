"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type FontSize = "normal" | "large" | "xlarge";

const SCALE: Record<FontSize, number> = {
  normal: 1,
  large: 1.15,
  xlarge: 1.3,
};

const STORAGE_KEY = "akce-zdar-font-size";

interface Ctx {
  size: FontSize;
  setSize: (s: FontSize) => void;
}

const FontSizeContext = createContext<Ctx | null>(null);

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [size, setSizeState] = useState<FontSize>(() => {
    if (typeof window === "undefined") return "normal";
    const v = localStorage.getItem(STORAGE_KEY);
    return (v === "large" || v === "xlarge" || v === "normal") ? v : "normal";
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--font-scale", String(SCALE[size]));
    localStorage.setItem(STORAGE_KEY, size);
  }, [size]);

  return (
    <FontSizeContext.Provider value={{ size, setSize: setSizeState }}>
      {children}
    </FontSizeContext.Provider>
  );
}

export function useFontSize() {
  const ctx = useContext(FontSizeContext);
  if (!ctx) throw new Error("useFontSize must be used within FontSizeProvider");
  return ctx;
}
