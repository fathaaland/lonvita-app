import type { ReactNode } from "react";

/** Lets a map grow wider than the narrow reading column it sits in (the 480px auth/visitor
 * column) — on a phone it simply fills the column, on larger screens it widens up to 64rem,
 * centred on the column and never past the viewport's side gutters. */
export function MapBreakout({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative left-1/2 -translate-x-1/2"
      style={{ width: "max(100%, min(calc(100vw - 2rem), 64rem))" }}
    >
      {children}
    </div>
  );
}
