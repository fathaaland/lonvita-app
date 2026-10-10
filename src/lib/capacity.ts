/**
 * "Neomezená kapacita" (unlimited capacity) isn't a real concept in the Events schema —
 * `capacity` stays a required positive integer (Registrations' capacity check just compares
 * counts against it). Unlimited is modelled as a large sentinel value instead, so every existing
 * comparison (`registrations_count < capacity`, fill-rate, etc.) keeps working unchanged; only
 * display spots need to special-case it to show "Neomezená kapacita" instead of the raw number.
 */
export const UNLIMITED_CAPACITY = 999999999

export const isUnlimitedCapacity = (capacity: number): boolean => capacity >= UNLIMITED_CAPACITY

/**
 * Whether a registration may rate its event (EventFeedback), and so is asked to (the feedback-request
 * job). Normally the pořadatel's attendance unlocks it — "Přišel/a". An event with unlimited capacity
 * keeps no attendance, so there it's whoever was still signed up (approved) once it was over.
 */
export function mayRateEvent(
  registration: { status: string; attendanceStatus?: string | null },
  event: { capacity: number; dateTime: string; endDateTime?: string | null },
  now: number = Date.now(),
): boolean {
  if (registration.status !== "approved") return false;
  if (!isUnlimitedCapacity(event.capacity)) return registration.attendanceStatus === "attended";
  return new Date(event.endDateTime ?? event.dateTime).getTime() < now;
}
