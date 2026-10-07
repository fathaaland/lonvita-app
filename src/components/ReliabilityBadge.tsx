"use client";

import { useState } from "react";
import { ShieldCheck, CalendarOff, UserX, ChevronDown } from "lucide-react";
import {
  describeReliability,
  formatRestrictedUntil,
  reliabilityLabel,
  RELIABILITY_WINDOW_MONTHS,
  type ReliabilityRecord,
} from "@/lib/reliability";
import { cn } from "@/lib/utils";

const LABELS = {
  reliable: { text: () => "Spolehlivý/á", icon: ShieldCheck, className: "bg-success-soft text-success" },
  frequent_excuses: { text: () => "Často se omlouvá", icon: CalendarOff, className: "bg-warning-soft text-warning-foreground" },
  no_shows: {
    text: (r: ReliabilityRecord) => `${r.noShows}× nedorazil/a bez omluvy`,
    icon: UserX,
    className: "bg-destructive/10 text-destructive",
  },
} as const;

/** How reliably a participant turns up (lib/reliability), next to their registration on the Spravovat
 * page — tapped open, the numbers behind it. Nothing for someone with no history yet. */
export function ReliabilityBadge({ record }: { record: ReliabilityRecord }) {
  const [open, setOpen] = useState(false);
  const label = reliabilityLabel(record);
  if (label === "new") return null;
  const { text, icon: Icon, className } = LABELS[label];

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold", className)}
      >
        <Icon className="h-4 w-4" aria-hidden />
        {text(record)}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <p className="text-sm text-muted-foreground">
          Za posledních {RELIABILITY_WINDOW_MONTHS} měsíců: {describeReliability(record)}.
          {record.restrictedUntil &&
            ` Přihlášky mu/jí do ${formatRestrictedUntil(record.restrictedUntil)} potvrzuje pořadatel — i na akce bez schvalování.`}
        </p>
      )}
    </div>
  );
}
