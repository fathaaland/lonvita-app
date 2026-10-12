/**
 * The obec's dashboard (admin-obce) as numbers — computed on the server (GET
 * /api/municipalities/:id/dashboard) so the browser no longer downloads every event, registration,
 * rating and profile of the obec to work them out. The same pure functions as before, so the page
 * shows exactly what it did; only where they run has changed.
 */

import {
  approvedParticipants,
  attendanceBreakdown,
  averageRatings,
  byCategory,
  byDayOfWeek,
  computeKpis,
  datavitaSeries,
  datavitaTrend,
  fillBuckets,
  filterEvents,
  filterRegistrations,
  periodStart,
  regStatusBreakdown,
  topEvents,
  topOrganizers,
  weeklySeries,
  type CategoryRow,
  type CategoryStat,
  type DatavitaPoint,
  type EventRow,
  type EventStat,
  type FeedbackRow,
  type Kpis,
  type OrganizerStat,
  type Period,
  type ProfileRow,
  type RegistrationRow,
  type WeekPoint,
} from "@/lib/analytics";
import { computeReportMetrics, type ProfileWithDob, type ReportMetrics } from "@/lib/report";

export const DASHBOARD_PERIODS: Period[] = ["7", "30", "90", "all"];

/** Everything the overview shows for one period ("posledních 30 dní", "celé období"…). */
export interface PeriodOverview {
  kpis: Kpis;
  categories: CategoryStat[];
  dayOfWeek: { day: string; events: number }[];
  organizers: OrganizerStat[];
  topEvents: EventStat[];
  status: ReturnType<typeof regStatusBreakdown>;
  fill: ReturnType<typeof fillBuckets>;
  attendance: ReturnType<typeof attendanceBreakdown>;
}

/** An event in the "Akce" table — with what the table shows beside it. */
export interface EventTableRow extends EventRow {
  /** Approved participants (volunteers hold no place). */
  approved: number;
  organizer_name: string | null;
}

export interface MunicipalityDashboard {
  categories: CategoryRow[];
  events: EventTableRow[];
  periods: Record<Period, PeriodOverview>;
  /** The last 12 weeks — the same whatever period is picked. */
  series: WeekPoint[];
  datavita: { series: DatavitaPoint[]; trend: ReturnType<typeof datavitaTrend> };
  ratings: ReturnType<typeof averageRatings>;
  /** The community report (CommunityReport, its DOCX/PDF export). */
  report: ReportMetrics;
}

export interface DashboardInput {
  events: EventRow[];
  registrations: RegistrationRow[];
  profiles: ProfileWithDob[];
  categories: CategoryRow[];
  feedback: FeedbackRow[];
}

/** The events with their approved count and organizer's name — the obec's dashboard (server) and
 * the organization page (browser) both list events this way. */
export function toEventTableRows(
  events: EventRow[],
  registrations: RegistrationRow[],
  profiles: Pick<ProfileRow, "user_id" | "full_name">[],
): EventTableRow[] {
  const approved = new Map<string, number>();
  for (const r of approvedParticipants(registrations)) approved.set(r.event_id, (approved.get(r.event_id) ?? 0) + 1);
  const names = new Map(profiles.map((p) => [p.user_id, p.full_name]));
  return events.map((e) => ({ ...e, approved: approved.get(e.id) ?? 0, organizer_name: names.get(e.organizer_id) ?? null }));
}

function periodOverview(period: Period, input: DashboardInput): PeriodOverview {
  const { events, registrations, profiles, categories } = input;
  const start = periodStart(period);
  const evF = filterEvents(events, start);
  const regF = filterRegistrations(registrations, start);
  return {
    kpis: computeKpis(evF, regF, profiles),
    categories: byCategory(evF, regF, categories),
    dayOfWeek: byDayOfWeek(evF),
    organizers: topOrganizers(evF, regF, profiles, 5),
    topEvents: topEvents(evF, regF, 5),
    status: regStatusBreakdown(regF, events),
    fill: fillBuckets(evF, regF),
    attendance: attendanceBreakdown(regF),
  };
}

export function computeMunicipalityDashboard(input: DashboardInput): MunicipalityDashboard {
  const { events, registrations, profiles, categories, feedback } = input;
  const series = datavitaSeries(events, registrations, profiles, 26);
  return {
    categories,
    events: toEventTableRows(events, registrations, profiles),
    periods: Object.fromEntries(DASHBOARD_PERIODS.map((p) => [p, periodOverview(p, input)])) as Record<Period, PeriodOverview>,
    series: weeklySeries(events, registrations, 12),
    datavita: { series, trend: datavitaTrend(series) },
    ratings: averageRatings(feedback),
    report: computeReportMetrics(events, registrations, profiles),
  };
}
