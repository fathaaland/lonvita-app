"use client";

import { cn } from "@/lib/utils";

/**
 * Wave-style progress bar — purple vlnka na sand pozadí.
 * value 0..1
 */
export function WaveProgress({
  value,
  className,
  label,
}: {
  value: number;
  className?: string;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className={cn("relative h-3 w-full overflow-hidden rounded-full bg-sand", className)}>
      <div
        className="absolute inset-y-0 left-0 bg-[hsl(var(--brand-purple))] transition-[width] duration-500"
        style={{ width: `${pct * 100}%` }}
        aria-label={label}
      >
        <svg
          className="absolute inset-0 h-full w-full opacity-50"
          viewBox="0 0 100 12"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0 6 Q 12.5 0 25 6 T 50 6 T 75 6 T 100 6 V12 H0 Z"
            fill="hsl(var(--brand-purple-dark))"
          />
        </svg>
      </div>
    </div>
  );
}
