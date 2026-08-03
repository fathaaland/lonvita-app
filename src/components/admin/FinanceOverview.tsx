"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wallet, Banknote, Receipt, Undo2 } from "lucide-react";
import { formatEventDate } from "@/lib/date";
import { formatCzk } from "@/lib/stripe";
import {
  Period,
  EventRow,
  RegistrationRow,
  periodStart,
  periodLabel,
  filterEvents,
  filterRegistrations,
  computeEconomy,
  topPaidEvents,
} from "@/lib/analytics";

interface Props {
  events: EventRow[];
  registrations: RegistrationRow[];
  municipalityName: string;
}

const PERIODS: { v: Period; label: string }[] = [
  { v: "7", label: "7 dní" },
  { v: "30", label: "30 dní" },
  { v: "90", label: "90 dní" },
  { v: "all", label: "Vše" },
];

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "primary",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  tone?: "primary" | "accent" | "success";
}) {
  const toneClass =
    tone === "success" ? "bg-success/10 text-success" :
    tone === "accent" ? "bg-accent/40 text-accent-foreground" :
    "bg-primary-soft text-primary";
  return (
    <div className="rounded-xl border p-3 space-y-1">
      <div className="flex items-center gap-2">
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <p className="text-[11px] text-muted-foreground leading-tight">{label}</p>
      </div>
      <p className="text-lg font-extrabold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function FinanceOverview({ events, registrations, municipalityName }: Props) {
  const [period, setPeriod] = useState<Period>("30");
  const start = useMemo(() => periodStart(period), [period]);
  const evF = useMemo(() => filterEvents(events, start), [events, start]);
  const regF = useMemo(() => filterRegistrations(registrations, start), [registrations, start]);
  const economy = useMemo(() => computeEconomy(evF, regF), [evF, regF]);
  const topPaid = useMemo(() => topPaidEvents(evF, regF, 10), [evF, regF]);

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-br from-primary-soft to-transparent border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-primary uppercase tracking-wide">Finance obce</p>
              <p className="text-lg font-extrabold">{municipalityName}</p>
              <p className="text-xs text-muted-foreground mt-1">Tok peněz v placených komunitních akcích</p>
            </div>
          </div>
          <div className="flex gap-1 mt-3">
            {PERIODS.map((p) => (
              <Button
                key={p.v}
                size="sm"
                variant={period === p.v ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => setPeriod(p.v)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {economy.paidEventsCount === 0 ? (
        <Card>
          <CardContent className="p-6 text-center space-y-2">
            <Wallet className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="font-bold">Zatím žádné placené akce</p>
            <p className="text-sm text-muted-foreground">
              V období {periodLabel(period)} v obci neproběhly placené akce.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <KpiCard icon={Banknote} label="Obrat" value={formatCzk(economy.grossCents)} sub={`${economy.paidRegistrations} plateb`} tone="primary" />
            <KpiCard icon={Receipt} label="Provize 5 %" value={formatCzk(economy.feeCents)} sub="platforma" tone="accent" />
            <KpiCard icon={Wallet} label="Pořadatelům" value={formatCzk(economy.netCents)} sub="po odečtu" tone="success" />
            <KpiCard icon={Undo2} label="Vráceno" value={formatCzk(economy.refundedCents)} sub={`${economy.refundedRegistrations}× refund`} tone="primary" />
          </div>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg bg-primary-soft p-3">
                  <p className="text-[11px] text-muted-foreground">Placené akce</p>
                  <p className="text-xl font-extrabold tabular-nums">{economy.paidEventsCount}</p>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-[11px] text-muted-foreground">Bezplatné akce</p>
                  <p className="text-xl font-extrabold tabular-nums">{economy.freeEventsCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {topPaid.length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <p className="text-sm font-bold">Placené akce podle obratu</p>
                <ol className="space-y-2">
                  {topPaid.map((e, i) => (
                    <li key={e.id} className="flex items-center gap-3 text-sm">
                      <span className="h-7 w-7 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-xs">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{e.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatEventDate(e.date_time)} · {formatCzk(e.priceCents)} × {e.paidCount}
                        </p>
                      </div>
                      <span className="text-sm font-extrabold tabular-nums">{formatCzk(e.grossCents)}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
