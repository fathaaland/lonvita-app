/**
 * US-H-07 font size + high contrast, shared by FontSizeContext (client) and the root layout's
 * pre-paint script (server). Kept out of the "use client" module: a server component importing a
 * constant from there gets a client reference, not the string.
 */

export type FontSize = "normal" | "large" | "xlarge";

export const FONT_SCALE: Record<FontSize, number> = {
  normal: 1,
  large: 1.15,
  xlarge: 1.3,
};

export const FONT_SIZE_STORAGE_KEY = "akce-zdar-font-size";
export const HIGH_CONTRAST_STORAGE_KEY = "akce-zdar-high-contrast";
export const HIGH_CONTRAST_CLASS = "high-contrast";

export const isFontSize = (value: unknown): value is FontSize =>
  value === "normal" || value === "large" || value === "xlarge";

/**
 * Applies the stored preferences to <html> before the first paint — the same trick next-themes
 * uses for dark mode. Without it, the static HTML renders at the default size and only jumps to
 * the visitor's own after hydration, which for the people who need large text is the flash that
 * hurts most. Reading a cookie in the layout would avoid the script, but would also turn every
 * prerendered page into a per-request render. Storage can throw (blocked cookies, some private
 * modes), so the defaults simply stay in that case.
 */
export const ACCESSIBILITY_PREFS_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  FONT_SIZE_STORAGE_KEY,
)});var m=${JSON.stringify(FONT_SCALE)};if(m[s])document.documentElement.style.setProperty("--font-scale",String(m[s]));if(localStorage.getItem(${JSON.stringify(
  HIGH_CONTRAST_STORAGE_KEY,
)})==="1")document.documentElement.classList.add(${JSON.stringify(HIGH_CONTRAST_CLASS)})}catch(e){}})()`;
