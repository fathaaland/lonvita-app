"use client";

import { useEffect, useState } from "react";
import { getMyReliability } from "@/integrations/payload/queries";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarOff, UserCheck, UserX } from "lucide-react";
import {
  formatRestrictedUntil,
  NO_SHOW_LIMIT,
  RELIABILITY_WINDOW_MONTHS,
  type ReliabilityRecord,
} from "@/lib/reliability";

/** "Vaše docházka" — the same numbers the organizers see next to the user's registrations
 * (lib/reliability), so nothing about them happens behind their back. */
export function AttendanceRecordCard() {
  const [record, setRecord] = useState<ReliabilityRecord | null>(null);

  useEffect(() => {
    getMyReliability().then(setRecord).catch(() => setRecord(null));
  }, []);

  if (!record) return null;

  const items = [
    { label: "Přišel/a", value: record.attended, icon: UserCheck },
    { label: "Omluvil/a se", value: record.excused, icon: CalendarOff },
    { label: "Nedorazil/a bez omluvy", value: record.noShows, icon: UserX },
  ];

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div>
          <p className="font-bold text-sm">Vaše docházka</p>
          <p className="text-sm text-muted-foreground mt-0.5">Za posledních {RELIABILITY_WINDOW_MONTHS} měsíců. Totéž vidí pořadatelé u vaší přihlášky.</p>
        </div>
        <ul className="grid grid-cols-3 gap-2 text-center">
          {items.map(({ label, value, icon: Icon }) => (
            <li key={label} className="rounded-lg bg-muted px-2 py-2.5">
              <Icon className="mx-auto h-4 w-4 text-muted-foreground" aria-hidden />
              <p className="mt-1 text-2xl font-extrabold tabular-nums leading-none">{value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{label}</p>
            </li>
          ))}
        </ul>
        {record.restrictedUntil ? (
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-foreground">
            Bez omluvy jste nedorazil/a {record.noShows}×, a tak vám přihlášky do{" "}
            {formatRestrictedUntil(record.restrictedUntil)} potvrzuje pořadatel — i na akce bez schvalování.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nemůžete-li přijít, odhlaste se v aplikaci, nebo dejte vědět pořadateli. Kdo bez omluvy nedorazí{" "}
            {NO_SHOW_LIMIT}× za {RELIABILITY_WINDOW_MONTHS} měsíců, tomu přihlášky na čas potvrzuje pořadatel.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
