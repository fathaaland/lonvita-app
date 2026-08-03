"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
  Area,
  AreaChart,
} from "recharts";
import {
  CalendarDays,
  Users,
  TrendingUp,
  UserPlus,
  Repeat,
  Target,
  Award,
  Sparkles,
  Download,
  Wallet,
  Banknote,
  Receipt,
  Undo2,
} from "lucide-react";
import { getCategoryIcon } from "@/lib/icons";
import { formatEventDate } from "@/lib/date";
import { formatCzk } from "@/lib/stripe";
import {
  Period,
  EventRow,
  RegistrationRow,
  CategoryRow,
  ProfileRow,
  periodStart,
  periodLabel,
  filterEvents,
  filterRegistrations,
  computeKpis,
  weeklySeries,
  byCategory,
  byDayOfWeek,
  topOrganizers,
  topEvents,
  regStatusBreakdown,
  fillBuckets,
  buildEventsCsv,
  computeEconomy,
  topPaidEvents,
  datavitaSeries,
  datavitaTrend,
  DATAVITA_MIN_PARTICIPANTS,
  DATAVITA_MIN_EVENTS,
} from "@/lib/analytics";

interface Props {
  events: EventRow[];
  registrations: RegistrationRow[];
  categories: CategoryRow[];
  profiles: ProfileRow[];
  municipalityName: string;
}

const PERIODS: { v: Period; label: string }[] = [
  { v: "7", label: "7 dní" },
  { v: "30", label: "30 dní" },
  { v: "90", label: "90 dní" },
  { v: "all", label: "Vše" },
];

export function AnalyticsOverview({
  events,
  registrations,
  categories,
  profiles,
  municipalityName,
}: Props) {
  const [period, setPeriod] = useState<Period>("30");

  const start = useMemo(() => periodStart(period), [period]);
  const evF = useMemo(() => filterEvents(events, start), [events, start]);
  const regF = useMemo(() => filterRegistrations(registrations, start), [registrations, start]);

  const kpis = useMemo(() => computeKpis(evF, regF, profiles), [evF, regF, profiles]);
  const series = useMemo(() => weeklySeries(events, registrations, 12), [events, registrations]);
  const cats = useMemo(() => byCategory(evF, regF, categories), [evF, regF, categories]);
  const dow = useMemo(() => byDayOfWeek(evF), [evF]);
  const orgs = useMemo(() => topOrganizers(evF, regF, profiles, 5), [evF, regF, profiles]);
  const top = useMemo(() => topEvents(evF, regF, 5), [evF, regF]);
  const rs = useMemo(() => regStatusBreakdown(regF), [regF]);
  const fill = useMemo(() => fillBuckets(evF, regF), [evF, regF]);
  const economy = useMemo(() => computeEconomy(evF, regF), [evF, regF]);
  const topPaid = useMemo(() => topPaidEvents(evF, regF, 5), [evF, regF]);
  const dvSeries = useMemo(() => datavitaSeries(events, registrations, profiles, 26), [events, registrations, profiles]);
  const dvTrend = useMemo(() => datavitaTrend(dvSeries), [dvSeries]);

  const handleExport = () => {
    const csv = buildEventsCsv(evF, regF, categories, profiles);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prehled-${municipalityName}-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pieStatus = [
    { name: "Schváleno", value: rs.approved, color: "hsl(var(--success))" },
    { name: "Čeká", value: rs.pending, color: "hsl(var(--warning))" },
    { name: "Zamítnuto", value: rs.rejected, color: "hsl(var(--destructive))" },
  ].filter((d) => d.value > 0);

  const pieFill = [
    { name: "Plné (≥85 %)", value: fill.full, color: "hsl(var(--success))" },
    { name: "Vyhovující", value: fill.ok, color: "hsl(var(--primary))" },
    { name: "Poloprázdné", value: fill.low, color: "hsl(var(--warning))" },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-5">
      {/* Filtr období + export */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 gap-1 bg-muted rounded-lg p-1">
          {PERIODS.map((p) => (
            <button
              key={p.v}
              onClick={() => setPeriod(p.v)}
              className={`flex-1 h-9 rounded-md text-sm font-semibold transition-colors ${
                period === p.v
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} className="h-11">
          <Download className="h-4 w-4" /> CSV
        </Button>
      </div>

      <p className="text-xs text-muted-foreground -mt-2">
        Data za {periodLabel(period)} · {municipalityName}
      </p>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-2 md:gap-3">
        <KpiCard icon={CalendarDays} label="Akcí" value={kpis.eventsTotal} sub={`${kpis.eventsUpcoming} nadcházejících`} tone="primary" />
        <KpiCard icon={Users} label="Aktivních lidí" value={kpis.activeUsers30d} sub="za 30 dní" tone="success" />
        <KpiCard icon={TrendingUp} label="Přihlášek" value={kpis.approvedRegs} sub={`${kpis.pendingRegs} čeká`} tone="primary" />
        <KpiCard icon={Target} label="Naplněnost" value={`${Math.round(kpis.avgFillRate * 100)} %`} sub="průměr akcí" tone="accent" />
        <KpiCard icon={UserPlus} label="Noví uživatelé" value={kpis.newUsers30d} sub="za 30 dní" tone="success" />
        <KpiCard icon={Award} label="Pořadatelů" value={kpis.activeOrganizers} sub="aktivních" tone="primary" />
        <KpiCard icon={Repeat} label="Vrací se" value={`${Math.round(kpis.repeatParticipationRate * 100)} %`} sub="lidí 2+ akce" tone="accent" />
        <KpiCard icon={Sparkles} label="Aktivita" value={kpis.avgEventsPerActive.toFixed(1)} sub="akcí / člověk" tone="primary" />
      </div>

      {/* Datavita — index vitality komunity */}
      <Card className="overflow-hidden">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-bold text-base flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-accent" />
                Datavita index
              </p>
              <p className="text-xs text-muted-foreground">
                Kompozitní skóre vitality komunity · posledních 26 týdnů
              </p>
            </div>
            {dvTrend.current !== null && (
              <div className="text-right">
                <p className="text-3xl font-extrabold leading-none tabular-nums">{dvTrend.current}</p>
                <p
                  className={`text-xs font-bold tabular-nums ${
                    dvTrend.delta > 0
                      ? "text-success"
                      : dvTrend.delta < 0
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  {dvTrend.delta > 0 ? "▲" : dvTrend.delta < 0 ? "▼" : "•"} {Math.abs(dvTrend.delta)} vs. měsíc zpět
                </p>
              </div>
            )}
          </div>
          {dvTrend.current === null ? (
            <div className="py-6 text-center space-y-1">
              <p className="text-sm font-semibold">Nedostatek dat</p>
              <p className="text-xs text-muted-foreground">
                Potřeba alespoň {DATAVITA_MIN_PARTICIPANTS} aktivních účastníků a {DATAVITA_MIN_EVENTS} akcí za posledních 7 dní.
              </p>
            </div>
          ) : (
            <>
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dvSeries} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="dvGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval={3} />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v: number) => [`${v}`, "Skóre"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="score"
                      stroke="hsl(var(--accent))"
                      strokeWidth={2.5}
                      fill="url(#dvGrad)"
                      connectNulls={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                D1 participace (zapojení + retence) · D2 organizace (organizátoři + dobrovolníci). Equity úprava zatím není zapojená.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Časová řada */}

      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <p className="font-bold text-base">Akce a účast v čase</p>
            <p className="text-xs text-muted-foreground">Posledních 12 týdnů</p>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="events" name="Akce" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="registrations" name="Přihlášky" stroke="hsl(var(--accent))" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Kategorie */}
      {cats.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <p className="font-bold text-base">Akce podle kategorie</p>
              <p className="text-xs text-muted-foreground">Co lidi nejvíc baví</p>
            </div>
            <div className="space-y-2">
              {cats.map((c) => {
                const Icon = getCategoryIcon(c.icon);
                const max = Math.max(...cats.map((x) => x.events));
                const w = max ? (c.events / max) * 100 : 0;
                return (
                  <div key={c.id} className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <Icon className="h-4 w-4" style={{ color: c.color }} />
                      <span className="font-semibold flex-1">{c.name}</span>
                      <span className="font-bold tabular-nums">{c.events}</span>
                      <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
                        {Math.round(c.fillRate * 100)} %
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${w}%`, backgroundColor: c.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Den v týdnu + stav přihlášek */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <p className="font-bold text-base">Kdy se konají</p>
              <p className="text-xs text-muted-foreground">Den v týdnu</p>
            </div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dow} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="events" name="Akce" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <p className="font-bold text-base">Stav přihlášek</p>
              <p className="text-xs text-muted-foreground">Rozložení v období</p>
            </div>
            {pieStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Žádná data.</p>
            ) : (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieStatus} dataKey="value" nameKey="name" innerRadius={32} outerRadius={60} paddingAngle={2}>
                      {pieStatus.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top pořadatelé + Top akce */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <p className="font-bold text-base">Nejaktivnější pořadatelé</p>
              <p className="text-xs text-muted-foreground">Podle účasti</p>
            </div>
            {orgs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Žádná data.</p>
            ) : (
              <ol className="space-y-2">
                {orgs.map((o, i) => (
                  <li key={o.id} className="flex items-center gap-3 text-sm">
                    <span className="h-7 w-7 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-xs">
                      {i + 1}
                    </span>
                    <span className="font-semibold flex-1 truncate">{o.name}</span>
                    <Badge variant="secondary" className="font-bold">{o.events} akcí</Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">{o.approved} lidí</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <p className="font-bold text-base">Nejúspěšnější akce</p>
              <p className="text-xs text-muted-foreground">Podle počtu přihlášených</p>
            </div>
            {top.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Žádná data.</p>
            ) : (
              <ol className="space-y-2">
                {top.map((e, i) => (
                  <li key={e.id} className="flex items-center gap-3 text-sm">
                    <span className="h-7 w-7 rounded-full bg-accent/10 text-accent font-bold flex items-center justify-center text-xs">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{e.title}</p>
                      <p className="text-xs text-muted-foreground">{formatEventDate(e.date_time)}</p>
                    </div>
                    <span className="text-xs font-bold tabular-nums">
                      {e.approved}/{e.capacity}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Ekonomika obce byla přesunuta do samostatné záložky Finance */}


      {/* Naplněnost */}
      {pieFill.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <p className="font-bold text-base">Naplněnost akcí</p>
              <p className="text-xs text-muted-foreground">Kolik akcí je dobře využitých</p>
            </div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieFill} dataKey="value" nameKey="name" innerRadius={32} outerRadius={60} paddingAngle={2}>
                    {pieFill.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  tone: "primary" | "success" | "accent";
}) {
  const toneClass =
    tone === "success" ? "text-success bg-success-soft"
    : tone === "accent" ? "text-accent bg-accent-soft"
    : "text-primary bg-primary-soft";
  return (
    <Card>
      <CardContent className="p-3 space-y-1.5">
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <p className="text-2xl font-extrabold leading-none tabular-nums">{value}</p>
        <p className="text-xs font-semibold">{label}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
