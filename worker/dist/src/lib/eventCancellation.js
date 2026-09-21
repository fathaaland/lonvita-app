/**
 * An event can be cancelled at the latest this many hours before it starts — after that people
 * may already be on their way, so it has to go ahead. Shared by the Events hook that enforces it
 * (src/collections/shared/eventCancellation.ts) and the UI that offers the cancel button.
 */
export const EVENT_CANCELLATION_CUTOFF_HOURS = 3;
export function eventCancellationDeadline(startIso) {
    return new Date(new Date(startIso).getTime() - EVENT_CANCELLATION_CUTOFF_HOURS * 60 * 60 * 1000);
}
export function canCancelEvent(startIso, now = Date.now()) {
    return now <= eventCancellationDeadline(startIso).getTime();
}
