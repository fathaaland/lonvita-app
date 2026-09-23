/**
 * Pomocné čisté funkce pro analytiku admin dashboardu.
 * Vše počítáno na klientovi z dat omezených přes RLS na obec.
 */

export type Period = "7" | "30" | "90" | "all";

export interface EventRow {
  id: string;
  title: string;
  date_time: string;
  capacity: number;
  status: string;
  category_ids: string[];
  organizer_id: string;
  created_at: string;
  is_paid?: boolean;
  price_cents?: number | null;
  is_volunteering?: boolean;
  /** Co-organized under the obec admin — the viewer can't edit or cancel it (Events.lockedForViewer). */
  locked_for_viewer?: boolean;
  /** Run with other organizers — deleting needs their consent, done from the event detail. */
  deletion_needs_consent?: boolean;
}

export interface RegistrationRow {
  id: string;
  event_id: string;
  user_id: string;
  status: string;
  created_at: string;
  attendance_status?: "not_marked" | "attended" | "no_show" | "excused";
}

export interface CategoryRow {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export interface ProfileRow {
  id: string;
  full_name: string;
  created_at: string;
  date_of_birth?: string | null;
}

export interface FeedbackRow {
  id: string;
  registration_id: string;
  satisfaction_rating: number;
  felt_welcome_rating: number | null;
}

/** Age on a given date from an ISO date-of-birth string — shared by the Datavita calc and the report. */
export function ageOn(dobIso: string, on: Date): number {
  const dob = new Date(dobIso);
  let age = on.getFullYear() - dob.getFullYear();
  const m = on.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < dob.getDate())) age--;
  return age;
}

export function periodStart(period: Period): Date | null {
  if (period === "all") return null;
  const days = parseInt(period, 10);
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function periodLabel(period: Period): string {
  return period === "all" ? "celé období" : `posledních ${period} dní`;
}

function inPeriod(iso: string, start: Date | null): boolean {
  if (!start) return true;
  return new Date(iso).getTime() >= start.getTime();
}

export function filterEvents(events: EventRow[], start: Date | null): EventRow[] {
  return events.filter((e) => inPeriod(e.date_time, start));
}

export function filterRegistrations(regs: RegistrationRow[], start: Date | null): RegistrationRow[] {
  return regs.filter((r) => inPeriod(r.created_at, start));
}

/* ===== KPI ===== */

export interface Kpis {
  eventsTotal: number;
  eventsUpcoming: number;
  eventsPast: number;
  approvedRegs: number;
  pendingRegs: number;
  activeUsers30d: number;
  newUsers30d: number;
  activeOrganizers: number;
  avgFillRate: number; // 0..1
  repeatParticipationRate: number; // 0..1 — % lidí s 2+ přihláškami
  avgEventsPerActive: number;
}

export function computeKpis(
  events: EventRow[],
  regs: RegistrationRow[],
  profiles: ProfileRow[],
): Kpis {
  const now = Date.now();
  const eventsUpcoming = events.filter((e) => new Date(e.date_time).getTime() >= now && e.status === "active").length;
  const eventsPast = events.filter((e) => new Date(e.date_time).getTime() < now).length;

  const approved = regs.filter((r) => r.status === "approved");
  const pending = regs.filter((r) => r.status === "pending");

  const cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const activeUserIds = new Set(
    approved.filter((r) => new Date(r.created_at).getTime() >= cutoff30).map((r) => r.user_id),
  );
  const newUserIds = profiles.filter((p) => new Date(p.created_at).getTime() >= cutoff30);
  const activeOrganizers = new Set(events.map((e) => e.organizer_id)).size;

  // Fill rate per akce (bereme jen akce s kapacitou > 0)
  const fillRates: number[] = [];
  for (const e of events) {
    if (!e.capacity) continue;
    const count = approved.filter((r) => r.event_id === e.id).length;
    fillRates.push(Math.min(1, count / e.capacity));
  }
  const avgFillRate = fillRates.length ? fillRates.reduce((a, b) => a + b, 0) / fillRates.length : 0;

  // Opakovaná účast
  const userCounts = new Map<string, number>();
  for (const r of approved) userCounts.set(r.user_id, (userCounts.get(r.user_id) ?? 0) + 1);
  const totalActive = userCounts.size;
  const repeating = Array.from(userCounts.values()).filter((c) => c >= 2).length;
  const repeatParticipationRate = totalActive ? repeating / totalActive : 0;
  const avgEventsPerActive = totalActive
    ? Array.from(userCounts.values()).reduce((a, b) => a + b, 0) / totalActive
    : 0;

  return {
    eventsTotal: events.length,
    eventsUpcoming,
    eventsPast,
    approvedRegs: approved.length,
    pendingRegs: pending.length,
    activeUsers30d: activeUserIds.size,
    newUsers30d: newUserIds.length,
    activeOrganizers,
    avgFillRate,
    repeatParticipationRate,
    avgEventsPerActive,
  };
}

/* ===== Časové řady (po týdnech) ===== */

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0 ne ... 6 so
  const diff = day === 0 ? -6 : 1 - day; // pondělí
  x.setDate(x.getDate() + diff);
  return x;
}

function fmtWeek(d: Date): string {
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

export interface WeekPoint {
  week: string;
  events: number;
  registrations: number;
}

export function weeklySeries(events: EventRow[], regs: RegistrationRow[], weeks = 12): WeekPoint[] {
  const today = startOfWeek(new Date());
  const out: WeekPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const wStart = new Date(today);
    wStart.setDate(wStart.getDate() - i * 7);
    const wEnd = new Date(wStart);
    wEnd.setDate(wEnd.getDate() + 7);
    const evs = events.filter((e) => {
      const t = new Date(e.date_time).getTime();
      return t >= wStart.getTime() && t < wEnd.getTime();
    }).length;
    const rs = regs.filter((r) => {
      if (r.status !== "approved") return false;
      const t = new Date(r.created_at).getTime();
      return t >= wStart.getTime() && t < wEnd.getTime();
    }).length;
    out.push({ week: fmtWeek(wStart), events: evs, registrations: rs });
  }
  return out;
}

/* ===== Datavita score =====
 * Kompozitní index vitality komunity 0-100, podle funkční spec dashboardu obce (sekce 6):
 *
 *   D1 (participace) = 0,5 × Míra_zapojení + 0,5 × Retence
 *   D2 (organizace)  = 0,5 × Organizátoři_index + 0,5 × Podíl_dobrovolníků
 *   Datavita_jádro   = 0,5 × D1 + 0,5 × D2
 *
 * Bezpečnostní práh: < 30 aktivních účastníků NEBO < 5 akcí v okně → score = null
 * ("nedostatek dat"), přesně podle spec §6.7.
 *
 * Dvě záměrné odchylky od plné spec, dokud pro ně nemáme datový podklad:
 *  - Míra_zapojení dělí aktivní účastníky počtem REGISTROVANÝCH profilů 50+, ne skutečnou
 *    populací obce 50+ (tu obec zatím nikam nezadává) — fáze 1 aproximace, stejně jako
 *    v src/lib/report.ts.
 *  - Organizátoři_index normalizuje syrový počet organizátorů (ne na 1000 obyvatel 50+,
 *    tu populaci nemáme) proti vlastnímu klouzavému ročnímu průměru — self-referenční,
 *    jak spec pro fázi 1 povoluje.
 *  - Equity modifikátor (D3/D4a/D4b, ±10 bodů) NENÍ implementovaný — D3 (geografické
 *    pokrytí) potřebuje vazbu Events → MunicipalityAreas, kterou zatím events nemají.
 *    Score je tedy jen Datavita_jádro, bez equity úpravy.
 */

export const DATAVITA_MIN_PARTICIPANTS = 30;
export const DATAVITA_MIN_EVENTS = 5;

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function activeParticipantIds(events: EventRow[], regs: RegistrationRow[], ws: number, we: number): Set<string> {
  const eventIds = new Set(events.filter((e) => {
    const t = new Date(e.date_time).getTime();
    return t >= ws && t < we;
  }).map((e) => e.id));
  return new Set(
    regs
      .filter((r) => r.attendance_status === "attended" && eventIds.has(r.event_id))
      .map((r) => r.user_id),
  );
}

/** Trailing self-referential baseline for Organizátoři_index — average organizer count over
 * windows of the same length as `windowLengthMs`, looking back up to a year before `windowStart`. */
function trailingOrganizerReference(events: EventRow[], windowStart: number, windowLengthMs: number): number {
  const lookbackMs = 365 * 24 * 60 * 60 * 1000;
  const counts: number[] = [];
  let cursor = windowStart;
  const earliest = windowStart - lookbackMs;
  while (cursor - windowLengthMs >= earliest) {
    cursor -= windowLengthMs;
    const orgIds = new Set(
      events
        .filter((e) => {
          const t = new Date(e.date_time).getTime();
          return t >= cursor && t < cursor + windowLengthMs;
        })
        .map((e) => e.organizer_id),
    );
    counts.push(orgIds.size);
  }
  return counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
}

export interface DatavitaWindowResult {
  score: number | null; // null = "nedostatek dat" (§6.7)
  participation: number; // D1, 0..100
  organization: number; // D2, 0..100
  engagementRate: number; // 0..1
  retentionRate: number; // 0..1
  organizerIndex: number; // 0..100
  volunteerShare: number; // 0..1
  activeParticipants: number;
  eventsCount: number;
}

export function computeDatavitaWindow(
  events: EventRow[],
  regs: RegistrationRow[],
  profiles50Plus: Set<string>,
  windowStart: number,
  windowEnd: number,
  prevParticipants: Set<string>,
): DatavitaWindowResult {
  const wEvents = events.filter((e) => {
    const t = new Date(e.date_time).getTime();
    return t >= windowStart && t < windowEnd;
  });
  const participants = activeParticipantIds(events, regs, windowStart, windowEnd);

  const denominator = profiles50Plus.size || 1;
  const engagementRate = Math.min(1, participants.size / denominator);

  const returning = Array.from(prevParticipants).filter((uid) => participants.has(uid)).length;
  const retentionRate = prevParticipants.size ? returning / prevParticipants.size : 0;

  const orgIds = new Set(wEvents.map((e) => e.organizer_id));
  const reference = trailingOrganizerReference(events, windowStart, windowEnd - windowStart);
  const organizerIndex = reference > 0
    ? Math.min(100, (orgIds.size / reference) * 100)
    : orgIds.size > 0 ? 100 : 0;

  const volunteerEventIds = new Set(wEvents.filter((e) => e.is_volunteering).map((e) => e.id));
  const volunteerParticipants = new Set(
    regs
      .filter((r) => r.attendance_status === "attended" && volunteerEventIds.has(r.event_id))
      .map((r) => r.user_id),
  );
  const volunteerShare = participants.size ? volunteerParticipants.size / participants.size : 0;

  const d1 = 0.5 * (engagementRate * 100) + 0.5 * (retentionRate * 100);
  const d2 = 0.5 * organizerIndex + 0.5 * (volunteerShare * 100);
  const core = 0.5 * d1 + 0.5 * d2;

  const insufficientData = participants.size < DATAVITA_MIN_PARTICIPANTS || wEvents.length < DATAVITA_MIN_EVENTS;

  return {
    score: insufficientData ? null : Math.round(core),
    participation: Math.round(d1),
    organization: Math.round(d2),
    engagementRate,
    retentionRate,
    organizerIndex,
    volunteerShare,
    activeParticipants: participants.size,
    eventsCount: wEvents.length,
  };
}

export interface DatavitaPoint {
  week: string;
  weekStart: string; // ISO
  score: number | null; // 0..100, null = nedostatek dat
  events: number;
  activeUsers: number;
  fillRate: number; // 0..1, kept for the "naplněnost" chart card
}

export function datavitaSeries(
  events: EventRow[],
  regs: RegistrationRow[],
  profiles: ProfileRow[],
  weeks = 26,
): DatavitaPoint[] {
  const today = startOfWeek(new Date());
  const now = new Date();
  const profiles50Plus = new Set(
    profiles.filter((p) => p.date_of_birth && ageOn(p.date_of_birth, now) >= 50).map((p) => p.id),
  );
  const approved = regs.filter((r) => r.status === "approved");

  const out: DatavitaPoint[] = [];
  let prevParticipants = new Set<string>();

  for (let i = weeks - 1; i >= 0; i--) {
    const wStart = new Date(today);
    wStart.setDate(wStart.getDate() - i * 7);
    const ws = wStart.getTime();
    const we = ws + ONE_WEEK_MS;

    const result = computeDatavitaWindow(events, regs, profiles50Plus, ws, we, prevParticipants);

    const wEvents = events.filter((e) => {
      const t = new Date(e.date_time).getTime();
      return t >= ws && t < we;
    });
    const fillRates: number[] = [];
    for (const e of wEvents) {
      if (!e.capacity) continue;
      const cnt = approved.filter((r) => r.event_id === e.id).length;
      fillRates.push(Math.min(1, cnt / e.capacity));
    }
    const fillRate = fillRates.length ? fillRates.reduce((a, b) => a + b, 0) / fillRates.length : 0;

    out.push({
      week: fmtWeek(wStart),
      weekStart: wStart.toISOString(),
      score: result.score,
      events: result.eventsCount,
      activeUsers: result.activeParticipants,
      fillRate,
    });

    prevParticipants = activeParticipantIds(events, regs, ws, we);
  }

  return out;
}

export function datavitaTrend(series: DatavitaPoint[]): { current: number | null; delta: number } {
  if (series.length === 0) return { current: null, delta: 0 };
  const current = series[series.length - 1].score;
  const scored = (pts: DatavitaPoint[]) => pts.map((p) => p.score).filter((s): s is number => s !== null);
  const prevScores = scored(series.slice(-8, -4));
  const recentScores = scored(series.slice(-4));
  const prev = prevScores.length ? prevScores.reduce((a, b) => a + b, 0) / prevScores.length : current;
  const recent = recentScores.length ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length : current;
  if (prev === null || recent === null) return { current, delta: 0 };
  return { current, delta: Math.round(recent - prev) };
}

/* ===== Kategorie ===== */

export interface CategoryStat {
  id: string;
  name: string;
  color: string;
  icon: string;
  events: number;
  approved: number;
  capacity: number;
  fillRate: number;
}

export function byCategory(
  events: EventRow[],
  regs: RegistrationRow[],
  categories: CategoryRow[],
): CategoryStat[] {
  const approved = regs.filter((r) => r.status === "approved");
  return categories
    .map((c) => {
      const evs = events.filter((e) => e.category_ids.includes(c.id));
      const evIds = new Set(evs.map((e) => e.id));
      const cap = evs.reduce((s, e) => s + (e.capacity || 0), 0);
      const appr = approved.filter((r) => evIds.has(r.event_id)).length;
      return {
        id: c.id,
        name: c.name,
        color: c.color,
        icon: c.icon,
        events: evs.length,
        approved: appr,
        capacity: cap,
        fillRate: cap ? Math.min(1, appr / cap) : 0,
      };
    })
    .filter((c) => c.events > 0)
    .sort((a, b) => b.events - a.events);
}

/* ===== Den v týdnu ===== */

const DAY_LABELS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

export function byDayOfWeek(events: EventRow[]): { day: string; events: number }[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const e of events) {
    const d = new Date(e.date_time).getDay(); // 0 ne ... 6 so
    const idx = d === 0 ? 6 : d - 1;
    counts[idx]++;
  }
  return DAY_LABELS.map((day, i) => ({ day, events: counts[i] }));
}

/* ===== Top pořadatelé ===== */

export interface OrganizerStat {
  id: string;
  name: string;
  events: number;
  approved: number;
}

export function topOrganizers(
  events: EventRow[],
  regs: RegistrationRow[],
  profiles: ProfileRow[],
  limit = 5,
): OrganizerStat[] {
  const approved = regs.filter((r) => r.status === "approved");
  const map = new Map<string, OrganizerStat>();
  const nameMap = new Map(profiles.map((p) => [p.id, p.full_name]));
  for (const e of events) {
    const cur = map.get(e.organizer_id) ?? {
      id: e.organizer_id,
      name: nameMap.get(e.organizer_id) ?? "Neznámý",
      events: 0,
      approved: 0,
    };
    cur.events += 1;
    cur.approved += approved.filter((r) => r.event_id === e.id).length;
    map.set(e.organizer_id, cur);
  }
  return Array.from(map.values())
    .sort((a, b) => b.approved - a.approved || b.events - a.events)
    .slice(0, limit);
}

/* ===== Top akce ===== */

export interface EventStat {
  id: string;
  title: string;
  date_time: string;
  capacity: number;
  approved: number;
  fillRate: number;
}

export function topEvents(events: EventRow[], regs: RegistrationRow[], limit = 5): EventStat[] {
  const approved = regs.filter((r) => r.status === "approved");
  return events
    .map((e) => {
      const a = approved.filter((r) => r.event_id === e.id).length;
      return {
        id: e.id,
        title: e.title,
        date_time: e.date_time,
        capacity: e.capacity,
        approved: a,
        fillRate: e.capacity ? Math.min(1, a / e.capacity) : 0,
      };
    })
    .sort((a, b) => b.approved - a.approved)
    .slice(0, limit);
}

/* ===== Stav přihlášek ===== */

export function regStatusBreakdown(regs: RegistrationRow[]) {
  const out = { approved: 0, pending: 0, rejected: 0 };
  for (const r of regs) {
    if (r.status === "approved") out.approved++;
    else if (r.status === "pending") out.pending++;
    else out.rejected++;
  }
  return out;
}

/* ===== Docházka ===== */

export function attendanceBreakdown(regs: RegistrationRow[]) {
  const marked = regs.filter((r) => r.status === "approved" && r.attendance_status && r.attendance_status !== "not_marked");
  const out = { attended: 0, no_show: 0, excused: 0 };
  for (const r of marked) {
    if (r.attendance_status === "attended") out.attended++;
    else if (r.attendance_status === "no_show") out.no_show++;
    else if (r.attendance_status === "excused") out.excused++;
  }
  return { ...out, total: marked.length };
}

/* ===== Hodnocení (EventFeedback) ===== */

export function averageRatings(feedback: FeedbackRow[]) {
  if (feedback.length === 0) return { avgSatisfaction: null, avgFeltWelcome: null, count: 0 };
  const avgSatisfaction = feedback.reduce((s, f) => s + f.satisfaction_rating, 0) / feedback.length;
  const welcomeRatings = feedback.filter((f): f is FeedbackRow & { felt_welcome_rating: number } => f.felt_welcome_rating !== null);
  const avgFeltWelcome = welcomeRatings.length
    ? welcomeRatings.reduce((s, f) => s + f.felt_welcome_rating, 0) / welcomeRatings.length
    : null;
  return { avgSatisfaction, avgFeltWelcome, count: feedback.length };
}

/* ===== Naplněnost ===== */

export function fillBuckets(events: EventRow[], regs: RegistrationRow[]) {
  const approved = regs.filter((r) => r.status === "approved");
  let full = 0, ok = 0, low = 0;
  for (const e of events) {
    if (!e.capacity) continue;
    const a = approved.filter((r) => r.event_id === e.id).length;
    const ratio = a / e.capacity;
    if (ratio >= 0.85) full++;
    else if (ratio >= 0.4) ok++;
    else low++;
  }
  return { full, ok, low };
}

/* ===== CSV export ===== */

export function buildEventsCsv(
  events: EventRow[],
  regs: RegistrationRow[],
  categories: CategoryRow[],
  profiles: ProfileRow[],
): string {
  const cats = new Map(categories.map((c) => [c.id, c.name]));
  const profs = new Map(profiles.map((p) => [p.id, p.full_name]));
  const approved = regs.filter((r) => r.status === "approved");
  const pending = regs.filter((r) => r.status === "pending");
  const header = ["Název", "Datum", "Kategorie", "Pořadatel", "Kapacita", "Schváleno", "Čeká", "Naplněnost %", "Stav"];
  const rows = events.map((e) => {
    const a = approved.filter((r) => r.event_id === e.id).length;
    const p = pending.filter((r) => r.event_id === e.id).length;
    const fill = e.capacity ? Math.round((a / e.capacity) * 100) : 0;
    return [
      e.title,
      new Date(e.date_time).toLocaleString("cs-CZ"),
      e.category_ids.map((id) => cats.get(id)).filter(Boolean).join(", "),
      profs.get(e.organizer_id) ?? "",
      String(e.capacity),
      String(a),
      String(p),
      String(fill),
      e.status,
    ];
  });
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
}


