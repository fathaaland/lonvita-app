/**
 * Report obce — výpočet metrik pro dva klouzavé 90denní intervaly
 * (aktuální vs. minulé období) + rozpad Datavity na participaci a organizaci.
 */

import type {
  EventRow,
  RegistrationRow,
  ProfileRow,
} from "./analytics";
import { datavitaSeries } from "./analytics";

export interface ProfileWithDob extends ProfileRow {
  date_of_birth?: string | null;
}

export interface PeriodMetrics {
  eventsCount: number;
  participantsUnique: number;
  approvedRegistrations: number;
  avgFillRate: number; // 0..1
  activeOrganizers: number;
  newOrganizers: number;
  engagementRate50Plus: number; // 0..1  (unikátní 50+ účastníci / 50+ profily v obci)
  retentionRate: number; // 0..1  (% z účastníků minulého okna, kteří se objevili i teď)
}

export interface ReportMetrics {
  periodLabel: string;
  periodFrom: string; // ISO date
  periodTo: string;
  previousLabel: string;
  current: PeriodMetrics;
  previous: PeriodMetrics;
  totalMembers50Plus: number;
  datavita: {
    current: number;
    previous: number; // ~90 dní zpět
    delta90d: number;
    participation: number; // 0..100
    organization: number; // 0..100
    trend: "roste" | "klesá" | "stabilní";
  };
}

function ageOn(dobIso: string, on: Date): number {
  const dob = new Date(dobIso);
  let age = on.getFullYear() - dob.getFullYear();
  const m = on.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < dob.getDate())) age--;
  return age;
}

function fmtDate(d: Date): string {
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

function windowMetrics(
  events: EventRow[],
  regs: RegistrationRow[],
  allEvents: EventRow[],
  profiles50Plus: Set<string>,
  windowStart: Date,
  windowEnd: Date,
  prevWindowStart: Date,
  prevWindowEnd: Date,
): PeriodMetrics {
  const ws = windowStart.getTime();
  const we = windowEnd.getTime();

  const wEvents = events.filter((e) => {
    const t = new Date(e.date_time).getTime();
    return t >= ws && t < we;
  });
  const wEventIds = new Set(wEvents.map((e) => e.id));
  const wRegs = regs.filter(
    (r) =>
      r.status === "approved" &&
      wEventIds.has(r.event_id),
  );

  const participants = new Set(wRegs.map((r) => r.user_id));

  // Fill rate — jen akce s kapacitou
  const fills: number[] = [];
  for (const e of wEvents) {
    if (!e.capacity) continue;
    const cnt = regs.filter(
      (r) => r.event_id === e.id && r.status === "approved",
    ).length;
    fills.push(Math.min(1, cnt / e.capacity));
  }
  const avgFillRate = fills.length ? fills.reduce((a, b) => a + b, 0) / fills.length : 0;

  const orgIds = new Set(wEvents.map((e) => e.organizer_id));

  // Noví organizátoři: první akce (kdykoli v allEvents) leží v okně
  const firstEventByOrg = new Map<string, number>();
  for (const e of allEvents) {
    const t = new Date(e.date_time).getTime();
    const prev = firstEventByOrg.get(e.organizer_id);
    if (prev === undefined || t < prev) firstEventByOrg.set(e.organizer_id, t);
  }
  let newOrganizers = 0;
  for (const oid of orgIds) {
    const first = firstEventByOrg.get(oid);
    if (first !== undefined && first >= ws && first < we) newOrganizers++;
  }

  // Zapojení 50+
  const participants50 = new Set(
    Array.from(participants).filter((uid) => profiles50Plus.has(uid)),
  );
  const engagementRate50Plus =
    profiles50Plus.size > 0 ? participants50.size / profiles50Plus.size : 0;

  // Retence: z účastníků minulého okna kolik se vrátilo teď
  const pws = prevWindowStart.getTime();
  const pwe = prevWindowEnd.getTime();
  const prevEventIds = new Set(
    events
      .filter((e) => {
        const t = new Date(e.date_time).getTime();
        return t >= pws && t < pwe;
      })
      .map((e) => e.id),
  );
  const prevParticipants = new Set(
    regs
      .filter((r) => r.status === "approved" && prevEventIds.has(r.event_id))
      .map((r) => r.user_id),
  );
  let returning = 0;
  for (const uid of prevParticipants) if (participants.has(uid)) returning++;
  const retentionRate = prevParticipants.size > 0 ? returning / prevParticipants.size : 0;

  return {
    eventsCount: wEvents.length,
    participantsUnique: participants.size,
    approvedRegistrations: wRegs.length,
    avgFillRate,
    activeOrganizers: orgIds.size,
    newOrganizers,
    engagementRate50Plus,
    retentionRate,
  };
}

export function computeReportMetrics(
  events: EventRow[],
  regs: RegistrationRow[],
  profiles: ProfileWithDob[],
): ReportMetrics {
  const now = new Date();
  const currentEnd = new Date(now); currentEnd.setHours(0, 0, 0, 0);
  const currentStart = new Date(currentEnd); currentStart.setDate(currentStart.getDate() - 90);
  const previousEnd = new Date(currentStart);
  const previousStart = new Date(previousEnd); previousStart.setDate(previousStart.getDate() - 90);

  const profiles50Plus = new Set(
    profiles
      .filter((p) => p.date_of_birth && ageOn(p.date_of_birth, now) >= 50)
      .map((p) => p.id),
  );

  const current = windowMetrics(
    events, regs, events, profiles50Plus,
    currentStart, currentEnd,
    previousStart, previousEnd,
  );
  // Pro minulé období: retenci počítáme z okna [-180,-90] vs. přechozí okno [-270,-180]
  const prevPrevEnd = new Date(previousStart);
  const prevPrevStart = new Date(prevPrevEnd); prevPrevStart.setDate(prevPrevStart.getDate() - 90);
  const previous = windowMetrics(
    events, regs, events, profiles50Plus,
    previousStart, previousEnd,
    prevPrevStart, prevPrevEnd,
  );

  // Datavita rozpad
  const series = datavitaSeries(events, regs, profiles, 26);
  const last = series[series.length - 1]?.score ?? 0;
  const idx90 = Math.max(0, series.length - 13); // ~13 týdnů zpět = 90 dní
  const prev90 = series[idx90]?.score ?? last;
  const delta = last - prev90;

  // Participation = 40% aktivní účast + 25% naplněnost (poměrová váha 40/65 a 25/65)
  // Organization = 20% počet akcí + 15% noví uživatelé (poměrová váha 20/35 a 15/35)
  const recent = series.slice(-4);
  const maxActive = Math.max(1, ...series.map((s) => s.activeUsers));
  const maxEvents = Math.max(1, ...series.map((s) => s.events));
  const maxNew = Math.max(1, ...series.map((s) => s.newUsers));
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const participation = Math.round(
    100 *
      ((40 / 65) * avg(recent.map((r) => r.activeUsers / maxActive)) +
        (25 / 65) * avg(recent.map((r) => r.fillRate))),
  );
  const organization = Math.round(
    100 *
      ((20 / 35) * avg(recent.map((r) => r.events / maxEvents)) +
        (15 / 35) * avg(recent.map((r) => r.newUsers / maxNew))),
  );

  const trend: "roste" | "klesá" | "stabilní" =
    delta >= 3 ? "roste" : delta <= -3 ? "klesá" : "stabilní";

  const quarter = Math.floor(now.getMonth() / 3) + 1;
  const periodLabel = `${quarter}. čtvrtletí ${now.getFullYear()}`;

  return {
    periodLabel,
    periodFrom: fmtDate(currentStart),
    periodTo: fmtDate(currentEnd),
    previousLabel: `${fmtDate(previousStart)} – ${fmtDate(previousEnd)}`,
    current,
    previous,
    totalMembers50Plus: profiles50Plus.size,
    datavita: {
      current: last,
      previous: prev90,
      delta90d: delta,
      participation,
      organization,
      trend,
    },
  };
}

/* ===== Formátování ===== */

export function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)} %`;
}

export function deltaPP(current: number, previous: number): string {
  const diff = (current - previous) * 100;
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toFixed(1)} p. b.`;
}

export function deltaAbs(current: number, previous: number): string {
  const diff = current - previous;
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff}`;
}

export function deltaPctChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "nové" : "0 %";
  const diff = ((current - previous) / previous) * 100;
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toFixed(0)} %`;
}

/* ===== Řádky tabulky pro report ===== */

export interface ReportRow {
  metric: string;
  current: string;
  previous: string;
  change: string;
}

export function buildReportRows(m: ReportMetrics): ReportRow[] {
  const c = m.current;
  const p = m.previous;
  return [
    {
      metric: "Počet komunitních aktivit",
      current: String(c.eventsCount),
      previous: String(p.eventsCount),
      change: deltaAbs(c.eventsCount, p.eventsCount),
    },
    {
      metric: "Unikátní účastníci",
      current: String(c.participantsUnique),
      previous: String(p.participantsUnique),
      change: deltaPctChange(c.participantsUnique, p.participantsUnique),
    },
    {
      metric: "Přihlášek (schválených)",
      current: String(c.approvedRegistrations),
      previous: String(p.approvedRegistrations),
      change: deltaPctChange(c.approvedRegistrations, p.approvedRegistrations),
    },
    {
      metric: "Míra zapojení 50+",
      current: pct(c.engagementRate50Plus),
      previous: pct(p.engagementRate50Plus),
      change: deltaPP(c.engagementRate50Plus, p.engagementRate50Plus),
    },
    {
      metric: "Retence účastníků",
      current: pct(c.retentionRate),
      previous: pct(p.retentionRate),
      change: deltaPP(c.retentionRate, p.retentionRate),
    },
    {
      metric: "Průměrná naplněnost akcí",
      current: pct(c.avgFillRate),
      previous: pct(p.avgFillRate),
      change: deltaPP(c.avgFillRate, p.avgFillRate),
    },
    {
      metric: "Aktivní organizátoři",
      current: String(c.activeOrganizers),
      previous: String(p.activeOrganizers),
      change: deltaAbs(c.activeOrganizers, p.activeOrganizers),
    },
    {
      metric: "Noví organizátoři",
      current: String(c.newOrganizers),
      previous: String(p.newOrganizers),
      change: deltaAbs(c.newOrganizers, p.newOrganizers),
    },
  ];
}
