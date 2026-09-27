import type { EventRow, RegistrationRow } from "./analytics";
import { isUnlimitedCapacity } from "./capacity";

/** The "Organizace" page's headline numbers — also printed in the worker-rendered PDF. */
export interface OrganizationStats {
  eventCount: number;
  coOrganizedCount: number;
  people: number;
  returning: number;
  pending: number;
  /** 0..1, `null` while no event has a limited capacity. */
  fillRate: number | null;
}

/** What the participants said about the organization's events, in aggregate — shares are 0..1,
 * `null` while nobody has answered that question. */
export type OrganizationFeedbackSummary = {
  count: number;
  avg_satisfaction: number | null;
  avg_felt_welcome: number | null;
  met_someone_new_share: number | null;
  came_alone_share: number | null;
};

export function computeOrganizationStats(
  events: EventRow[],
  registrations: RegistrationRow[],
  coOrganizedIds: Set<string>,
  now: number = Date.now(),
): OrganizationStats {
  const live = events.filter((e) => e.status !== "cancelled");
  const liveIds = new Set(live.map((e) => e.id));
  const approved = registrations.filter((r) => r.status === "approved" && liveIds.has(r.event_id));
  // Only where it still matters — a pending registration on a past event won't be approved anymore.
  const upcomingIds = new Set(live.filter((e) => new Date(e.date_time).getTime() >= now).map((e) => e.id));
  const pending = registrations.filter((r) => r.status === "pending" && upcomingIds.has(r.event_id));

  const perPerson = new Map<string, number>();
  for (const r of approved) perPerson.set(r.user_id, (perPerson.get(r.user_id) ?? 0) + 1);
  const returning = [...perPerson.values()].filter((n) => n >= 2).length;

  // "Bez omezení kapacity" would read as an empty event and drag the average down.
  const rates = live
    .filter((e) => e.capacity > 0 && !isUnlimitedCapacity(e.capacity))
    .map((e) => Math.min(1, approved.filter((r) => r.event_id === e.id).length / e.capacity));

  return {
    eventCount: live.length,
    coOrganizedCount: live.filter((e) => coOrganizedIds.has(e.id)).length,
    people: perPerson.size,
    returning,
    pending: pending.length,
    fillRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
  };
}

export const formatDecimal = (value: number) => value.toLocaleString("cs-CZ", { maximumFractionDigits: 1 });
export const formatPercent = (share: number) => `${Math.round(share * 100)} %`;
