import { cn } from "@/lib/utils";

/** "3 nepřečtená oznámení" — what a screen reader says instead of the bare number. */
export function unreadLabel(count: number): string {
  if (count === 1) return "1 nepřečtené oznámení";
  if (count >= 2 && count <= 4) return `${count} nepřečtená oznámení`;
  return `${count} nepřečtených oznámení`;
}

/** How many notifications are waiting, pinned to the bell's corner. Renders nothing at zero. The
 * ring in the bar's own colour (`ringClassName`) keeps it legible where it overlaps the icon. */
export function UnreadBadge({ count, className, ringClassName = "ring-background" }: {
  count: number;
  className?: string;
  ringClassName?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "absolute flex h-5 min-w-5 items-center justify-center rounded-full px-1.5",
        "bg-destructive text-destructive-foreground text-xs font-bold leading-none tabular-nums ring-2",
        ringClassName,
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
