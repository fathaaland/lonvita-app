"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const STARS = [1, 2, 3, 4, 5];

/** A volunteer's average from organizers — amber stars and the number, or a quiet "zatím bez
 * hodnocení" so a newcomer doesn't read as badly rated. */
export function RatingBadge({
  rating,
  className,
}: {
  rating: { average: number; count: number } | null;
  className?: string;
}) {
  if (!rating) {
    return <span className={cn("text-xs text-muted-foreground", className)}>Zatím bez hodnocení</span>;
  }
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-sm font-bold tabular-nums", className)}
      aria-label={`Hodnocení ${rating.average.toLocaleString("cs-CZ")} z 5 (${rating.count}×)`}
    >
      <Star className="h-4 w-4 fill-rating text-rating drop-shadow-[0_0_4px_rgba(251,191,36,0.55)]" aria-hidden />
      {rating.average.toLocaleString("cs-CZ", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
      <span className="font-normal text-muted-foreground">({rating.count})</span>
    </span>
  );
}

/** Five stars, filled up to `value` — read-only, or a radio group when `onChange` is given. */
export function RatingStars({
  value,
  onChange,
  size = "md",
  label = "Hodnocení",
}: {
  value: number;
  onChange?: (value: number) => void;
  size?: "sm" | "md";
  label?: string;
}) {
  const iconClass = size === "sm" ? "h-4 w-4" : "h-7 w-7";
  if (!onChange) {
    return (
      <span className="inline-flex gap-0.5" aria-label={`${label}: ${value} z 5`}>
        {STARS.map((n) => (
          <Star
            key={n}
            aria-hidden
            className={cn(iconClass, n <= value ? "fill-rating text-rating" : "text-muted-foreground/40")}
          />
        ))}
      </span>
    );
  }
  return (
    <ToggleGroup
      type="single"
      value={value ? String(value) : ""}
      onValueChange={(v) => v && onChange(Number(v))}
      aria-label={label}
      className="inline-flex justify-start gap-1"
    >
      {STARS.map((n) => (
        <ToggleGroupItem
          key={n}
          value={String(n)}
          aria-label={`${n} z 5`}
          className={cn(
            "h-auto p-0.5 hover:bg-transparent data-[state=on]:bg-transparent",
            size === "sm" ? "[&_svg]:size-4" : "[&_svg]:size-7",
          )}
        >
          <Star
            className={cn(
              "transition-colors",
              n <= value ? "fill-rating text-rating" : "text-muted-foreground/40 hover:text-rating/70",
            )}
          />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
