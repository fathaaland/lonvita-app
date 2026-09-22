import type { ReactNode } from "react";

/** Lets a map grow wider than the narrow reading column it sits in (the 480px auth/visitor
 * column) — on a phone it simply fills the column, on larger screens it widens up to 64rem,
 * centred on the column. Sized in `cqw` (against the nearest `container-type: inline-size`
 * ancestor set up in AppShell) rather than `vw`, so on split-screen layouts it never grows
 * past its own lane and into the branding panel next to it. Centred with a negative margin, not
 * `-translate-x-1/2`: a transform lands on half pixels at odd widths and blurs the map tiles. */
const WIDTH = "max(100%, min(calc(100cqw - 2rem), 64rem))";

export function MapBreakout({ children }: { children: ReactNode }) {
  return (
    <div style={{ width: WIDTH, marginLeft: `calc((100% - ${WIDTH}) / 2)` }}>
      {children}
    </div>
  );
}
