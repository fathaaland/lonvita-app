/**
 * Report obce — výpočet metrik pro dva klouzavé 90denní intervaly
 * (aktuální vs. minulé období) + rozpad Datavity na participaci a organizaci.
 */

import type {
  EventRow,
  RegistrationRow,
  ProfileRow,
} from "./analytics";
import { computeDatavitaWindow, isAged50Plus } from "./analytics";

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
    current: number | null; // null = nedostatek dat (§6.7)
    previous: number | null;
    delta90d: number;
    participation: number; // D1, 0..100
    organization: number; // D2, 0..100
    trend: "roste" | "klesá" | "stabilní" | "nedostatek dat";
  };
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

  // "Míra zapojení" and retention track who actually showed up, not who was merely approved.
  const participants = new Set(
    regs.filter((r) => r.attendance_status === "attended" && wEventIds.has(r.event_id)).map((r) => r.user_id),
  );

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
      .filter((r) => r.attendance_status === "attended" && prevEventIds.has(r.event_id))
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
      .filter((p) => isAged50Plus(p, now))
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

  // Datavita — stejné jádro (D1/D2, §6) jako sparkline na dashboardu, jen na 90denních oknech.
  const prevPrevEnd90 = new Date(previousStart);
  const prevPrevStart90 = new Date(prevPrevEnd90); prevPrevStart90.setDate(prevPrevStart90.getDate() - 90);
  const prevParticipantsForCurrent = new Set(
    regs
      .filter((r) => {
        if (r.attendance_status !== "attended") return false;
        const ev = events.find((e) => e.id === r.event_id);
        if (!ev) return false;
        const t = new Date(ev.date_time).getTime();
        return t >= previousStart.getTime() && t < previousEnd.getTime();
      })
      .map((r) => r.user_id),
  );
  const prevParticipantsForPrevious = new Set(
    regs
      .filter((r) => {
        if (r.attendance_status !== "attended") return false;
        const ev = events.find((e) => e.id === r.event_id);
        if (!ev) return false;
        const t = new Date(ev.date_time).getTime();
        return t >= prevPrevStart90.getTime() && t < prevPrevEnd90.getTime();
      })
      .map((r) => r.user_id),
  );

  const dvCurrent = computeDatavitaWindow(
    events, regs, profiles50Plus, currentStart.getTime(), currentEnd.getTime(), prevParticipantsForCurrent,
  );
  const dvPrevious = computeDatavitaWindow(
    events, regs, profiles50Plus, previousStart.getTime(), previousEnd.getTime(), prevParticipantsForPrevious,
  );

  const delta = dvCurrent.score !== null && dvPrevious.score !== null ? dvCurrent.score - dvPrevious.score : 0;
  const trend: "roste" | "klesá" | "stabilní" | "nedostatek dat" =
    dvCurrent.score === null ? "nedostatek dat" : delta >= 3 ? "roste" : delta <= -3 ? "klesá" : "stabilní";

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
      current: dvCurrent.score,
      previous: dvPrevious.score,
      delta90d: delta,
      participation: dvCurrent.participation,
      organization: dvCurrent.organization,
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

/* ===== Texty reportu ===== */
// Shared by the dialog (preview, Markdown) and the worker's DOCX/PDF, so the downloaded file says
// exactly what the admin just read on screen.

export interface Narrative { summary: string; whatChanged: string }

/** Czech plural: 1 → `one`, 2–4 → `few`, otherwise (0, 5+) `many`. */
function cz(n: number, one: string, few: string, many: string): string {
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}

/** "je 62/100 a roste", or "zatím nejde spočítat" below the §6.7 sample-size threshold. */
function formatDatavitaScore(metrics: ReportMetrics): string {
  if (metrics.datavita.current === null) return "zatím nejde spočítat (nedostatek dat)";
  return `je ${metrics.datavita.current}/100 a ${metrics.datavita.trend}`;
}

function formatDatavitaDelta(metrics: ReportMetrics): string {
  if (metrics.datavita.current === null) return "Nedostatek dat pro výpočet indexu za toto období.";
  const d = metrics.datavita.delta90d;
  return `Datavita se za 90 dní změnila o ${d >= 0 ? "+" : ""}${d} bodů.`;
}

/** Deterministic, no-AI narrative built straight from the computed metrics. */
export function buildNarrative(metrics: ReportMetrics, municipalityName: string): Narrative {
  const c = metrics.current;
  const p = metrics.previous;
  const eventsDelta = c.eventsCount - p.eventsCount;
  const participantsDelta = c.participantsUnique - p.participantsUnique;

  const summary =
    `V období ${metrics.periodFrom} – ${metrics.periodTo} ${cz(c.eventsCount, "proběhla", "proběhly", "proběhlo")} ` +
    `v obci ${municipalityName} ${c.eventsCount} ${cz(c.eventsCount, "akce", "akce", "akcí")} ` +
    `s ${c.participantsUnique} ${cz(c.participantsUnique, "unikátním účastníkem", "unikátními účastníky", "unikátními účastníky")} ` +
    `a ${c.approvedRegistrations} ${cz(c.approvedRegistrations, "schválenou přihláškou", "schválenými přihláškami", "schválenými přihláškami")}. ` +
    `Komunitní index (Datavita) ${formatDatavitaScore(metrics)}.`;

  const whatChanged =
    `Počet akcí se oproti ${metrics.previousLabel} ${eventsDelta >= 0 ? "zvýšil" : "snížil"} o ${Math.abs(eventsDelta)}, ` +
    `počet unikátních účastníků se ${participantsDelta >= 0 ? "zvýšil" : "snížil"} o ${Math.abs(participantsDelta)}. ` +
    `Aktivních organizátorů: ${c.activeOrganizers} (${c.newOrganizers} nových). ` +
    formatDatavitaDelta(metrics);

  return { summary, whatChanged };
}

export function reportTitle(metrics: ReportMetrics, municipalityName: string): string {
  return `Přehled komunitního života — ${metrics.periodLabel} · ${municipalityName}`;
}

export function datavitaParagraph(metrics: ReportMetrics): string {
  const dv = metrics.datavita;
  if (dv.current === null) {
    return "Nedostatek dat za toto období (potřeba alespoň 30 aktivních účastníků a 5 akcí).";
  }
  return (
    `${dv.current}/100, ${dv.trend} (${dv.delta90d >= 0 ? "+" : ""}${dv.delta90d} bodů za 90 dní). ` +
    `Participace ${dv.participation}, organizace ${dv.organization} — rozpad ukazuje, zda růst ` +
    `komunity stojí především na účasti lidí, nebo na aktivitě organizátorů.`
  );
}

/** `generatedAt` in Prague time — the worker runs in a UTC container. */
export function methodologyParagraph(metrics: ReportMetrics, generatedAt: Date = new Date()): string {
  return (
    `Data z klouzavého 90denního okna (${metrics.periodFrom} – ${metrics.periodTo}), srovnání ` +
    `s předchozím 90denním oknem (${metrics.previousLabel}). Zdroj: platforma Lonvita, výpočet proběhl ` +
    `${generatedAt.toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })}. Nezahrnuje adresy bydliště účastníků ani údaje ze ` +
    `sociálně-preskripční vrstvy. Kompletní metodika Datavity dostupná na vyžádání.`
  );
}
