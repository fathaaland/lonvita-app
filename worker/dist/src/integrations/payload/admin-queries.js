/**
 * Query functions specific to the Admin dashboard (src/pages/Admin.tsx and
 * src/components/admin/*). Shaped to match src/lib/analytics.ts's EventRow/
 * RegistrationRow/CategoryRow/ProfileRow interfaces directly, since those pure
 * client-side analytics functions are unaware of Payload and expect that exact shape.
 */
import { buildQuery, buildWhereParams, del, get, patch } from "./client";
const toId = (value) => {
    if (value == null)
        return null;
    return String(typeof value === "object" ? value.id : value);
};
export async function getMunicipalityEventsForAdmin(municipalityId) {
    const where = buildWhereParams({ municipality: { equals: municipalityId } });
    const query = buildQuery({ depth: 0, limit: 1000 });
    const result = await get(`/events?${where}&${query}`);
    return result.docs.map((e) => ({
        id: String(e.id),
        title: e.title,
        date_time: e.dateTime,
        capacity: e.capacity,
        status: e.status,
        category_ids: (e.categories ?? []).map(toId).filter((v) => Boolean(v)),
        organizer_id: toId(e.organizer) ?? "",
        created_at: e.createdAt,
        is_paid: e.isPaid,
        price_cents: e.priceCents ?? null,
        is_volunteering: e.isVolunteering,
    }));
}
export async function getRegistrationsForEventIds(eventIds) {
    if (eventIds.length === 0)
        return [];
    const where = buildWhereParams({ event: { in: eventIds } });
    const query = buildQuery({ depth: 0, limit: 5000 });
    const result = await get(`/registrations?${where}&${query}`);
    return result.docs.map((r) => ({
        id: String(r.id),
        event_id: toId(r.event),
        user_id: toId(r.user),
        status: r.status,
        created_at: r.createdAt,
        attendance_status: (r.attendanceStatus ?? "not_marked"),
    }));
}
/** Feedback for every registration on these events — joined through `registration.event`,
 * since EventFeedback only relates to a registration, not directly to an event. Feeds the
 * admin overview's average-rating KPIs (US-A-08). */
export async function getFeedbackForEventIds(eventIds) {
    if (eventIds.length === 0)
        return [];
    const where = buildWhereParams({ "registration.event": { in: eventIds } });
    const query = buildQuery({ depth: 0, limit: 5000 });
    const result = await get(`/event-feedback?${where}&${query}`);
    return result.docs.map((f) => ({
        id: String(f.id),
        registration_id: toId(f.registration),
        satisfaction_rating: f.satisfactionRating,
        felt_welcome_rating: f.feltWelcomeRating ?? null,
    }));
}
export async function getAllCategoriesForAdmin() {
    const result = await get("/event-categories?limit=200");
    return result.docs.map((c) => ({ id: String(c.id), name: c.name, icon: c.icon ?? "", color: c.color ?? "" }));
}
export async function getMunicipalityProfilesForAdmin(municipalityId) {
    const where = buildWhereParams({ municipality: { equals: municipalityId } });
    const query = buildQuery({ depth: 0, limit: 2000 });
    const result = await get(`/profiles?${where}&${query}`);
    return result.docs.map((p) => ({
        id: String(p.id),
        full_name: p.fullName,
        created_at: p.createdAt,
        date_of_birth: p.dateOfBirth ?? null,
    }));
}
/** Cancels an event (soft-delete: sets deletedAt + status "cancelled") rather than hard-
 * deleting the row — works regardless of existing registrations, and triggers the
 * backend's notifyRegistrantsOnCancellation hook so pending/approved attendees are told.
 * Access-controlled to platform superadmins and the event's own municipality admin. */
export async function deleteEvent(eventId) {
    await patch(`/events/${eventId}`, { deletedAt: new Date().toISOString(), status: "cancelled" });
}
/** Removes an already-granted "Dobrovolnictví" flag directly — a plain field flip, distinct
 * from deciding a pending VolunteerFlagRequests row (US-A-09). */
export async function removeVolunteeringFlag(eventId) {
    await patch(`/events/${eventId}`, { isVolunteering: false });
}
export async function getOrganizerRequestsForAdmin(municipalityId) {
    const where = buildWhereParams({ municipality: { equals: municipalityId }, status: { equals: "pending" } });
    const query = buildQuery({ depth: 0, sort: "createdAt", limit: 200 });
    const result = await get(`/organizer-requests?${where}&${query}`);
    const userIds = Array.from(new Set(result.docs.map((r) => toId(r.user)).filter((v) => Boolean(v))));
    const nameById = new Map();
    if (userIds.length) {
        const profileWhere = buildWhereParams({ user: { in: userIds } });
        const profiles = await get(`/profiles?${profileWhere}&depth=0&limit=500`);
        for (const p of profiles.docs) {
            const uid = toId(p.user);
            if (uid)
                nameById.set(uid, p.fullName);
        }
    }
    return result.docs.map((r) => ({
        id: String(r.id),
        user_id: toId(r.user),
        full_name: nameById.get(toId(r.user) ?? "") ?? "Účastník",
        status: r.status,
        created_at: r.createdAt,
    }));
}
export async function decideOrganizerRequest(requestId, approve) {
    await patch(`/organizer-requests/${requestId}`, { status: approve ? "approved" : "rejected" });
}
/** Pending volunteering-flag requests for events in this municipality — filtered client-side
 * by event.municipality since the collection has no direct municipality field of its own. */
export async function getVolunteerFlagRequestsForAdmin(municipalityId) {
    const query = buildQuery({ depth: 1, sort: "createdAt", limit: 200 });
    const where = buildWhereParams({ status: { equals: "pending" } });
    const result = await get(`/volunteer-flag-requests?${where}&${query}`);
    const filtered = result.docs.filter((r) => toId(r.event?.municipality) === municipalityId);
    const userIds = Array.from(new Set(filtered.map((r) => toId(r.requestedBy)).filter((v) => Boolean(v))));
    const nameById = new Map();
    if (userIds.length) {
        const profileWhere = buildWhereParams({ user: { in: userIds } });
        const profiles = await get(`/profiles?${profileWhere}&depth=0&limit=500`);
        for (const p of profiles.docs) {
            const uid = toId(p.user);
            if (uid)
                nameById.set(uid, p.fullName);
        }
    }
    return filtered.map((r) => ({
        id: String(r.id),
        event_id: toId(r.event),
        event_title: r.event.title,
        requested_by_name: nameById.get(toId(r.requestedBy) ?? "") ?? "Organizátor",
        status: r.status,
        created_at: r.createdAt,
    }));
}
export async function decideVolunteerFlagRequest(requestId, approve) {
    await patch(`/volunteer-flag-requests/${requestId}`, { status: approve ? "approved" : "rejected" });
}
/** Users currently holding the "organizer" role in this municipality — mirrors the
 * superadmin panel's grant/revoke UI, but scoped to the admin's own obec. */
export async function getOrganizersForAdmin(municipalityId) {
    const where = buildWhereParams({ municipality: { equals: municipalityId }, role: { equals: "organizer" } });
    const query = buildQuery({ depth: 0, sort: "createdAt", limit: 500 });
    const result = await get(`/user-roles?${where}&${query}`);
    const userIds = Array.from(new Set(result.docs.map((r) => toId(r.user)).filter((v) => Boolean(v))));
    const nameById = new Map();
    if (userIds.length) {
        const profileWhere = buildWhereParams({ user: { in: userIds } });
        const profiles = await get(`/profiles?${profileWhere}&depth=0&limit=500`);
        for (const p of profiles.docs) {
            const uid = toId(p.user);
            if (uid)
                nameById.set(uid, p.fullName);
        }
    }
    return result.docs.map((r) => ({
        id: String(r.id),
        user_id: toId(r.user),
        full_name: nameById.get(toId(r.user) ?? "") ?? "Organizátor",
    }));
}
export async function revokeOrganizerRole(userRoleId) {
    await del(`/user-roles/${userRoleId}`);
}
