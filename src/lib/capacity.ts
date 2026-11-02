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

/**
 * SMS about a cancelled event go out only for events of at most this many places — anything bigger
 * (unlimited included) is announced in-app and by e-mail only, so one cancel can't eat the obec's SMS.
 * Both the pořadatel and the participants are told so up front (EventForm, the event detail).
 */
export const SMS_MAX_CAPACITY = 50

export const smsSentForCapacity = (capacity: number | null | undefined): boolean =>
  typeof capacity === "number" && capacity >= 1 && capacity <= SMS_MAX_CAPACITY
