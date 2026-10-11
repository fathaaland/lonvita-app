import { RELIABILITY_WINDOW_MONTHS } from '@/lib/reliability'

/**
 * How long Lonvita keeps what — the one place the nightly data-retention job
 * (worker/src/processors/data-retention.processor.ts) and its tests take the periods from.
 * Three rules hold for all of it:
 * - nothing an overview counts is removed: approved registrations of events that took place
 *   (attendance, Datavita, reliability), rejected ones (the "Zamítnuto" chart), ratings, roles;
 * - a decision is removed only once its audit-log entry is what remembers it, and every removal is
 *   itself written to the audit log, in the same transaction (`data-retention.purge`);
 * - the audit log has a floor nobody goes under — the database refuses it (migration
 *   20261011_200000_data_retention_audit_log, trigger `audit_log_guard`).
 */
export const RETENTION = {
  /** Audit log — at least 18 months (vyhláška č. 409/2025 Sb. § 22 odst. 5 písm. c, the stricter of
   * the two regimes of the cybersecurity act), kept for the 3-year general limitation period
   * (občanský zákoník § 629), then removed: a log with personal data in it can't be kept for ever
   * either (GDPR čl. 5 odst. 1 písm. e). */
  auditLogMonths: 36,
  /** The floor the database enforces on its own — keep in step with the trigger's interval. */
  auditLogMinimumMonths: 18,
  /** An upload nothing points at yet may be a cover picked in a form that hasn't been saved. */
  orphanMediaGraceHours: 48,
  /** A cancelled event (with what hangs off it), and a registration that ended up cancelled or was
   * never decided — counted from the event, past the reliability window, which still counts
   * omluvy (`selfCancelled`) on them. */
  staleEventDataMonths: RELIABILITY_WINDOW_MONTHS + 1,
  /** A decided request or invitation, once its event has started — nothing can be answered or
   * escalated any more. Longer than the pool's 30-day cooldown after a "no". */
  decidedRequestDays: 90,
  /** A decided organizer-role request — the applicant sees its outcome on their profile meanwhile. */
  organizerRequestMonths: 12,
} as const

/** `enforce` removes; anything else (the default) only counts what would go and logs it — every new
 * rule runs that way first, in production, before anybody switches it on. */
export type RetentionMode = 'enforce' | 'dry-run'

export const retentionMode = (): RetentionMode =>
  process.env.DATA_RETENTION_MODE?.trim().toLowerCase() === 'enforce' ? 'enforce' : 'dry-run'

export const monthsBefore = (now: Date, months: number): Date => {
  const date = new Date(now)
  date.setMonth(date.getMonth() - months)
  return date
}

export const daysBefore = (now: Date, days: number): Date => new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

export const hoursBefore = (now: Date, hours: number): Date => new Date(now.getTime() - hours * 60 * 60 * 1000)
