/**
 * How reliably a participant turns up — what the event's team sees next to their registration
 * (Spravovat), what they see on their own profile, and what decides the soft limit below. Counted
 * over the last RELIABILITY_WINDOW_MONTHS, so nobody carries an old slip around for good:
 * - came (attendance "attended");
 * - an omluva — gave up their approved place in the app in time (Registrations.selfCancelled), or
 *   called the organizer, who marked them "excused". Never held against anyone;
 * - didn't come and didn't say (attendance "no_show").
 * Volunteers aren't counted — they're rated by the event's creator instead (VolunteerRatings).
 * Shared by the server (collections/shared/reliability) and the UI.
 */

export const RELIABILITY_WINDOW_MONTHS = 6;

/** This many no-shows within the window and a sign-up for an event without approval waits for the
 * organizer instead — until the oldest of them drops out of the window. */
export const NO_SHOW_LIMIT = 3;

/** "Často se omlouvá" — at least this many omluvy, and more of them than events they came to. */
export const FREQUENT_EXCUSES_MIN = 3;

export type ReliabilityEntryKind = "attended" | "excused" | "no_show";

/** One registration's outcome, dated by when the event took place. */
export type ReliabilityEntry = { kind: ReliabilityEntryKind; at: string };

export type ReliabilityRecord = {
  attended: number;
  excused: number;
  noShows: number;
  /** While set, the participant's sign-ups for events without approval wait for the organizer. */
  restrictedUntil: string | null;
};

export type ReliabilityLabel = "reliable" | "frequent_excuses" | "no_shows" | "new";

export const EMPTY_RELIABILITY: ReliabilityRecord = { attended: 0, excused: 0, noShows: 0, restrictedUntil: null };

const addMonths = (date: Date, months: number): Date => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

export function reliabilityWindowStart(now: Date = new Date()): Date {
  return addMonths(now, -RELIABILITY_WINDOW_MONTHS);
}

export function summarizeReliability(entries: ReliabilityEntry[], now: Date = new Date()): ReliabilityRecord {
  const since = reliabilityWindowStart(now).getTime();
  const counted = entries.filter((e) => new Date(e.at).getTime() >= since);
  const noShowTimes = counted
    .filter((e) => e.kind === "no_show")
    .map((e) => new Date(e.at).getTime())
    .sort((a, b) => a - b);

  // Below the limit again once all but NO_SHOW_LIMIT - 1 of them have dropped out of the window.
  const restrictedUntil =
    noShowTimes.length >= NO_SHOW_LIMIT
      ? addMonths(new Date(noShowTimes[noShowTimes.length - NO_SHOW_LIMIT]), RELIABILITY_WINDOW_MONTHS).toISOString()
      : null;

  return {
    attended: counted.filter((e) => e.kind === "attended").length,
    excused: counted.filter((e) => e.kind === "excused").length,
    noShows: noShowTimes.length,
    restrictedUntil,
  };
}

export function reliabilityLabel(record: ReliabilityRecord): ReliabilityLabel {
  if (record.noShows > 0) return "no_shows";
  if (record.excused >= FREQUENT_EXCUSES_MIN && record.excused > record.attended) return "frequent_excuses";
  if (record.attended + record.excused > 0) return "reliable";
  return "new";
}

/** "5× přišel/a, 2× se omluvil/a, 1× nedorazil/a bez omluvy" — the numbers behind the label. */
export function describeReliability(record: ReliabilityRecord): string {
  return `${record.attended}× přišel/a, ${record.excused}× se omluvil/a, ${record.noShows}× nedorazil/a bez omluvy`;
}

/** "3. 4. 2027" — when the soft limit lifts. */
export function formatRestrictedUntil(iso: string): string {
  return new Date(iso).toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague" });
}
