/**
 * What an OrganizerRequest asks the obec for: the organizer role (optionally with access to the
 * volunteer pool), or — for someone who already organizes there — access to the pool alone.
 */
export const ORGANIZER_ROLE_KIND = 'role'
export const VOLUNTEER_ACCESS_KIND = 'volunteer_access'
export type OrganizerRequestKind = typeof ORGANIZER_ROLE_KIND | typeof VOLUNTEER_ACCESS_KIND
