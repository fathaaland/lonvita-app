/**
 * How long a request waits for its answer — shared by the collections that enforce it and the
 * screens that tell people about it, so the two can't drift apart.
 */

/** How long the other organizers (and the obec, when it co-organizes) have to answer a request to
 * delete the event they run together, before it lapses and the event stays. */
export const DELETION_CONSENT_HOURS = 24

/** How long an invited organization has to accept co-organizing — never past the event's start.
 * Whoever doesn't accept in time isn't on the event; the inviter may invite them again. */
export const CO_ORGANIZING_INVITATION_HOURS = 24

/** After a "no", the obec waits this long before asking the same person to join the pool again. */
export const POOL_INVITATION_DECLINE_COOLDOWN_DAYS = 30
