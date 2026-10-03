/**
 * An event has taken place once its end (single-day: its start) is past — from then on it's history
 * and nobody edits it any more, whatever their role. Behind the Events access check that enforces
 * it and the "finished" status the events read back with (src/collections/Events.ts), which is
 * what the UI hides Upravit by.
 */
export function hasEventEnded(
  startIso: string | null | undefined,
  endIso?: string | null,
  now: number = Date.now(),
): boolean {
  const endsAt = new Date(endIso ?? startIso ?? "").getTime();
  return !Number.isNaN(endsAt) && endsAt < now;
}
