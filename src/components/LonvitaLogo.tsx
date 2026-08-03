"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import symbolAsset from "@/assets/lonvita-symbol.png";

type Variant = "on-light" | "on-dark" | "on-purple";
type Size = "sm" | "md" | "lg" | "xl";

const sizeMap: Record<Size, { symbol: number; wordmark: string; gap: string }> = {
  sm: { symbol: 24, wordmark: "text-xl", gap: "gap-2" },
  md: { symbol: 32, wordmark: "text-2xl", gap: "gap-2.5" },
  lg: { symbol: 44, wordmark: "text-4xl", gap: "gap-3" },
  xl: { symbol: 72, wordmark: "text-7xl", gap: "gap-4" },
};

export function LonvitaLogo({
  variant = "on-light",
  size = "md",
  wordmark = true,
  className,
}: {
  variant?: Variant;
  size?: Size;
  wordmark?: boolean;
  className?: string;
}) {
  const { symbol, wordmark: wmSize, gap } = sizeMap[size];
  const wmColor =
    variant === "on-dark" ? "text-ivory" :
    variant === "on-purple" ? "text-white" :
    "text-graphite";

  return (
    <span className={cn("inline-flex items-center", gap, className)}>
      <Image
        src={symbolAsset}
        alt="Lonvita"
        width={symbol}
        height={symbol}
        style={{ width: symbol, height: symbol }}
        className="shrink-0"
        priority
      />
      {wordmark && (
        <span className={cn("font-display leading-none", wmSize, wmColor)}>
          Lonvita
        </span>
      )}
    </span>
  );
}

export function BrandWave({ className, color }: { className?: string; color?: string }) {
  return (
    <svg
      className={cn("pointer-events-none", className)}
      viewBox="0 0 600 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M30 80 C120 20, 220 160, 340 100 C460 40, 540 178, 640 122"
        stroke={color ?? "hsl(var(--brand-purple))"}
        strokeWidth="52"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
