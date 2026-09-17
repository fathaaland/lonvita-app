import type { ReactNode } from "react";

/** Lets a map grow wider than the narrow reading column it sits in (the 480px auth/visitor
 * column) — on a phone it simply fills the column, on larger screens it widens up to 64rem,
 * centred on the column. Sized in `cqw` (against the nearest `container-type: inline-size`
 * ancestor set up in AppShell) rather than `vw`, so on split-screen layouts it never grows
 * past its own lane and into the branding panel next to it. */
export function MapBreakout({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative left-1/2 -translate-x-1/2"
      style={{ width: "max(100%, min(calc(100cqw - 2rem), 64rem))" }}
    >
      {children}
    </div>
  );
}
