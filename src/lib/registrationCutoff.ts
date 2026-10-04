/**
 * Signing up for an event — and cancelling one's registration (with an optional excuse to the
 * organizer) — closes this many hours before it starts. Closer to the start the organizer may no
 * longer be watching the app: whoever still wants to join, or can't come after all, calls or e-mails
 * them instead. Shared by the hooks that enforce it (Registrations, VolunteerInvitations) and the UI
 * that offers the actions.
 */
export const REGISTRATION_CUTOFF_HOURS = 3;

export function registrationDeadline(startIso: string): Date {
  return new Date(new Date(startIso).getTime() - REGISTRATION_CUTOFF_HOURS * 60 * 60 * 1000);
}

/** Still time to sign up, or to cancel (with an excuse) through the app. */
export function isRegistrationOpen(startIso: string, now: number = Date.now()): boolean {
  return now <= registrationDeadline(startIso).getTime();
}
