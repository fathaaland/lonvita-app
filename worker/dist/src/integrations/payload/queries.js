/**
 * Query functions shaped to match what the (originally Supabase-backed) page components
 * already expect — snake_case field names, same nesting — so pages mostly only need their
 * data-fetching `useEffect` rewritten, not their JSX.
 */
import { buildQuery, buildWhereParams, get, patch, post, uploadFile } from "./client";
export async function getMunicipality(id) {
    try {
        const doc = await get(`/municipalities/${id}`);
        return {
            id: String(doc.id),
            name: doc.name,
            description: doc.description ?? null,
            lat: doc.lat,
            lng: doc.lng,
            rules_for_creation: doc.rulesForCreation ?? "approved_organizers",
        };
    }
    catch {
        return null;
    }
}
export async function setMunicipalityRulesForCreation(municipalityId, rules) {
    await patch(`/municipalities/${municipalityId}`, { rulesForCreation: rules });
}
export async function listMunicipalities() {
    const query = buildQuery({ sort: "name", limit: 200 });
    const result = await get(`/municipalities?${query}`);
    return result.docs.map((m) => ({ id: String(m.id), name: m.name, lat: m.lat, lng: m.lng }));
}
export async function getEventCategories() {
    const query = buildQuery({ sort: "name", limit: 200 });
    const result = await get(`/event-categories?${query}`);
    return result.docs.map((c) => ({
        id: String(c.id),
        name: c.name,
        icon: c.icon ?? "",
        color: c.color ?? "",
    }));
}
/** The organizations this organizer manages (brief §4 "Organizace" — free text, no obec approval). */
export async function getMyOrganizations(userId) {
    const where = buildWhereParams({ owner: { equals: userId } });
    const query = buildQuery({ sort: "name", limit: 200 });
    const result = await get(`/organizations?${where}&${query}`);
    return result.docs.map((o) => ({ id: String(o.id), name: o.name }));
}
export async function createOrganization(name, ownerId) {
    const doc = await post("/organizations", { name, owner: Number(ownerId) });
    return { id: String(doc.id), name: doc.name };
}
// --- Media (event cover image) -------------------------------------------------------------
/** Uploads the event cover image (brief §4 — crop to a fixed aspect ratio happens server-side
 * via Media.ts's `imageSizes`). Returns the media doc id to store on Events.image. */
export async function uploadEventImage(file, alt) {
    const uploaded = await uploadFile("media", file, { alt });
    return { id: String(uploaded.id), url: uploaded.url ?? null };
}
const toId = (value) => {
    if (value == null)
        return null;
    return String(typeof value === "object" ? value.id : value);
};
const mapEvent = (e) => ({
    id: String(e.id),
    title: e.title,
    description: e.description ?? undefined,
    date_time: e.dateTime,
    end_date_time: e.endDateTime ?? null,
    recurrence_rule: e.recurrenceRule ?? null,
    location_text: e.locationText,
    lat: e.lat ?? null,
    lng: e.lng ?? null,
    accessibility_tags: e.accessibilityTags ?? [],
    capacity: e.capacity,
    registration_approval_mode: e.registrationApprovalMode ?? "manual",
    image_url: typeof e.image === "object" && e.image ? (e.image.url ?? null) : null,
    image_position: { x: e.imagePositionX ?? 50, y: e.imagePositionY ?? 50 },
    category_ids: (e.categories ?? []).map(toId).filter((v) => Boolean(v)),
    organizer_id: toId(e.organizer) ?? undefined,
    organization_id: toId(e.organization),
    organization_name: typeof e.organization === "object" && e.organization ? (e.organization.name ?? null) : null,
    co_organizer_ids: (e.coOrganizers ?? []).map(toId).filter((v) => Boolean(v)),
    municipality_id: toId(e.municipality) ?? undefined,
    status: e.status,
    is_hidden: e.isHidden,
    is_paid: e.isPaid,
    price_cents: e.priceCents ?? null,
    is_volunteering: e.isVolunteering,
    cancellation_policy: e.cancellationPolicy ?? "cancel_48h",
});
/** Upcoming (not cancelled) events for a municipality — or, with `null`, across every
 * municipality ("bez obce" users, the "Všechny obce" view) — ordered by date, category populated. */
export async function getUpcomingEvents(municipalityId) {
    const where = buildWhereParams({
        ...(municipalityId ? { municipality: { equals: municipalityId } } : {}),
        status: { not_equals: "cancelled" },
        isHidden: { not_equals: true },
        dateTime: { greater_than: new Date().toISOString() },
    });
    const query = buildQuery({ sort: "dateTime", depth: 1, limit: 200 });
    const result = await get(`/events?${where}&${query}`);
    return result.docs.map(mapEvent);
}
/** Events this user organizes (any status/date) — "Moje akce" needs these alongside their
 * registrations, since creating an event doesn't register the organizer as an attendee. */
/** Events this user organizes OR co-organizes (brief §4 "Spolupořadatelství" — the event
 * appears in every co-organizer's own dashboard, not just the primary organizer's). */
export async function getMyOrganizedEvents(userId) {
    const where = `where[or][0][organizer][equals]=${userId}&where[or][1][coOrganizers][contains]=${userId}`;
    const query = buildQuery({ sort: "-dateTime", depth: 1, limit: 200 });
    const result = await get(`/events?${where}&${query}`);
    return result.docs.map(mapEvent);
}
export async function getEvent(id) {
    try {
        const doc = await get(`/events/${id}?depth=1`);
        return mapEvent(doc);
    }
    catch {
        return null;
    }
}
export async function createEvent(input) {
    const doc = await post("/events", {
        title: input.title,
        description: input.description,
        dateTime: input.dateTimeIso,
        endDateTime: input.endDateTimeIso || undefined,
        recurrenceRule: input.recurrenceRule || undefined,
        locationText: input.locationText,
        lat: input.lat,
        lng: input.lng,
        accessibilityTags: input.accessibilityTags ?? [],
        capacity: input.capacity,
        registrationApprovalMode: input.registrationApprovalMode ?? "manual",
        organizer: Number(input.organizerUserId),
        municipality: Number(input.municipalityId),
        organization: input.organizationId ? Number(input.organizationId) : undefined,
        coOrganizers: input.coOrganizerIds?.length ? input.coOrganizerIds.map(Number) : undefined,
        categories: input.categoryIds.map(Number),
        image: input.imageId ? Number(input.imageId) : undefined,
        imagePositionX: input.imagePositionX ?? 50,
        imagePositionY: input.imagePositionY ?? 50,
        status: "active",
        isPaid: input.isPaid ?? false,
        priceCents: input.isPaid ? input.priceCents : undefined,
        isVolunteering: input.isVolunteering ?? false,
        cancellationPolicy: "cancel_48h",
    });
    return mapEvent(doc);
}
export async function updateEvent(eventId, data) {
    const doc = await patch(`/events/${eventId}`, data);
    return mapEvent(doc);
}
const mapRegistration = (r) => ({
    id: String(r.id),
    event_id: toId(r.event),
    user_id: toId(r.user),
    status: r.status,
});
/** Approved/pending counts per event from the public counts route — registrations themselves are
 * only readable by the organizer and the obec's admin, so counts can't be derived from them here. */
export async function getRegistrationCounts(eventIds) {
    const counts = new Map();
    if (eventIds.length === 0)
        return counts;
    const params = new URLSearchParams();
    eventIds.forEach((id) => params.append("event", id));
    const result = await get(`/events/registration-counts?${params}`);
    for (const [eventId, row] of Object.entries(result.counts))
        counts.set(eventId, row);
    return counts;
}
/** Counts of pending+approved registrations, grouped by event_id — for capacity display. */
export async function getActiveRegistrationCountsByEvent(eventIds) {
    const counts = await getRegistrationCounts(eventIds);
    return new Map(Array.from(counts, ([eventId, row]) => [eventId, row.approved + row.pending]));
}
export async function createRegistration(eventId, userId) {
    const doc = await post("/registrations", {
        event: Number(eventId),
        user: Number(userId),
        status: "pending",
    });
    return mapRegistration(doc);
}
export async function cancelRegistration(registrationId) {
    await patch(`/registrations/${registrationId}`, { status: "cancelled" });
}
export async function updateRegistrationStatus(registrationId, status) {
    await patch(`/registrations/${registrationId}`, { status });
}
/** For MyEvents.tsx — this user's registrations, with the event (and its categories) populated. */
export async function getMyRegistrationsWithEvents(userId) {
    const where = buildWhereParams({ user: { equals: userId } });
    const query = buildQuery({ depth: 2, limit: 200 });
    const result = await get(`/registrations?${where}&${query}`);
    return result.docs.map((r) => {
        const attendance_status = r.attendanceStatus ?? "not_marked";
        if (!r.event || typeof r.event !== "object")
            return { id: String(r.id), status: r.status, attendance_status, events: null };
        const event = mapEvent(r.event);
        const categories = (r.event.categories ?? [])
            .filter((c) => typeof c === "object" && "name" in c)
            .map((c) => ({ id: String(c.id), name: c.name, icon: c.icon ?? "", color: c.color ?? "" }));
        return { id: String(r.id), status: r.status, attendance_status, events: { ...event, categories } };
    });
}
const mapEventFeedback = (f) => ({
    id: String(f.id),
    registration_id: toId(f.registration),
    satisfaction_rating: f.satisfactionRating,
    felt_welcome_rating: f.feltWelcomeRating ?? null,
    met_someone_new: Boolean(f.metSomeoneNew),
    came_alone: Boolean(f.cameAlone),
    comment: f.comment ?? null,
});
/** Feedback already left for any of the given registrations, keyed by registration id — for
 * deciding which past attended events still need a feedback prompt. */
export async function getMyFeedbackForRegistrations(registrationIds) {
    const byRegistration = new Map();
    if (registrationIds.length === 0)
        return byRegistration;
    const where = buildWhereParams({ registration: { in: registrationIds } });
    const result = await get(`/event-feedback?${where}&depth=0&limit=500`);
    for (const doc of result.docs) {
        const row = mapEventFeedback(doc);
        byRegistration.set(row.registration_id, row);
    }
    return byRegistration;
}
export async function submitEventFeedback(input) {
    const doc = await post("/event-feedback", {
        registration: Number(input.registrationId),
        satisfactionRating: input.satisfactionRating,
        feltWelcomeRating: input.feltWelcomeRating,
        metSomeoneNew: input.metSomeoneNew ?? false,
        cameAlone: input.cameAlone ?? false,
        comment: input.comment || undefined,
    });
    return mapEventFeedback(doc);
}
/** For EventDetail.tsx — pending+approved registrations for one event, with each participant's name. */
export async function getEventRegistrationsWithNames(eventId) {
    const where = buildWhereParams({
        event: { equals: eventId },
        status: { in: ["pending", "approved"] },
    });
    const result = await get(`/registrations?${where}&depth=0&limit=500`);
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
        status: r.status,
        full_name: nameById.get(toId(r.user) ?? "") ?? "Účastník",
    }));
}
export async function getOrganizerName(userId) {
    const where = buildWhereParams({ user: { equals: userId } });
    const result = await get(`/profiles?${where}&limit=1&depth=0`);
    return result.docs[0]?.fullName ?? null;
}
/** For ManageEvent.tsx — every registration for one event (any status), with name+phone. */
export async function getEventRegistrationsForManage(eventId) {
    const where = buildWhereParams({ event: { equals: eventId } });
    const result = await get(`/registrations?${where}&depth=0&limit=500&sort=createdAt`);
    const userIds = Array.from(new Set(result.docs.map((r) => toId(r.user)).filter((v) => Boolean(v))));
    const infoById = new Map();
    if (userIds.length) {
        const profileWhere = buildWhereParams({ user: { in: userIds } });
        const profiles = await get(`/profiles?${profileWhere}&depth=0&limit=500`);
        for (const p of profiles.docs) {
            const uid = toId(p.user);
            if (uid)
                infoById.set(uid, { fullName: p.fullName, phone: p.phone ?? null });
        }
    }
    return result.docs.map((r) => {
        const uid = toId(r.user);
        const info = infoById.get(uid);
        return {
            id: String(r.id),
            status: r.status,
            attendance_status: r.attendanceStatus ?? "not_marked",
            user_id: uid,
            full_name: info?.fullName ?? "Účastník",
            phone: info?.phone ?? null,
        };
    });
}
/** Organizer marks what actually happened, on the manage-event page. */
export async function updateAttendance(registrationId, attendanceStatus, markedByUserId) {
    await patch(`/registrations/${registrationId}`, {
        attendanceStatus,
        attendanceMarkedAt: new Date().toISOString(),
        attendanceMarkedBy: Number(markedByUserId),
    });
}
const mapProfile = (p) => ({
    id: String(p.id),
    full_name: p.fullName,
    phone: p.phone ?? null,
    phone_verified: Boolean(p.phoneVerified),
    notify_email: p.notifyEmail ?? true,
    notify_in_app: p.notifyInApp ?? true,
    municipality_id: toId(p.municipality),
    onboarding_completed: Boolean(p.onboardingCompleted),
    date_of_birth: p.dateOfBirth ?? null,
    home_area_id: toId(p.homeArea),
    gender: p.gender ?? null,
    interests: p.interests?.map((i) => toId(i)).filter(Boolean) ?? null,
    is_volunteer: Boolean(p.isVolunteer),
    volunteer_focus: p.volunteerFocus ?? null,
    volunteer_note: p.volunteerNote ?? null,
    volunteer_since: p.volunteerSince ?? null,
});
export async function getVolunteers(municipalityId) {
    const where = buildWhereParams({
        municipality: { equals: municipalityId },
        isVolunteer: { equals: true },
    });
    const query = buildQuery({ sort: "-volunteerSince", depth: 1, limit: 500 });
    const result = await get(`/profiles?${where}&${query}`);
    return result.docs.map((p) => ({
        id: String(p.id),
        user_id: String(typeof p.user === "object" ? p.user.id : p.user),
        full_name: p.fullName,
        phone: p.phone ?? null,
        email: typeof p.user === "object" ? p.user.email : null,
        volunteer_focus: p.volunteerFocus ?? null,
        volunteer_note: p.volunteerNote ?? null,
        volunteer_since: p.volunteerSince ?? null,
    }));
}
/** Admin adds someone (by user id) to their municipality's volunteer pool — Profiles.access.update
 * is self-only, so this goes through a dedicated overrideAccess endpoint. */
export async function addVolunteer(userId, municipalityId) {
    await post("/admin/volunteers", { userId: Number(userId), municipalityId: Number(municipalityId), isVolunteer: true });
}
/** Admin removes someone (by user id) from their municipality's volunteer pool. */
export async function removeVolunteer(userId, municipalityId) {
    await post("/admin/volunteers", { userId: Number(userId), municipalityId: Number(municipalityId), isVolunteer: false });
}
/** Display names for a list of user ids (e.g. co-organizers on an event detail page). */
export async function getFullNamesByUserIds(userIds) {
    const names = new Map();
    if (userIds.length === 0)
        return names;
    const where = buildWhereParams({ user: { in: userIds } });
    const result = await get(`/profiles?${where}&depth=0&limit=200`);
    for (const p of result.docs) {
        const uid = toId(p.user);
        if (uid)
            names.set(uid, p.fullName);
    }
    return names;
}
/** For CoOrganizerPicker — people with a profile in this municipality, matched by name, so an
 * organizer can pick a co-organizer without knowing their exact email. */
export async function searchMunicipalityUsers(municipalityId, query) {
    const trimmed = query.trim();
    if (trimmed.length < 2)
        return [];
    const where = buildWhereParams({
        municipality: { equals: municipalityId },
        fullName: { like: trimmed },
    });
    const q = buildQuery({ sort: "fullName", depth: 1, limit: 10 });
    const result = await get(`/profiles?${where}&${q}`);
    return result.docs
        .filter((p) => typeof p.user === "object")
        .map((p) => ({
        id: String(p.user.id),
        full_name: p.fullName,
        email: p.user.email ?? null,
    }));
}
export async function getMyProfile(userId) {
    const where = buildWhereParams({ user: { equals: userId } });
    const result = await get(`/profiles?${where}&limit=1&depth=0`);
    return result.docs[0] ? mapProfile(result.docs[0]) : null;
}
export async function updateProfile(profileId, data) {
    const doc = await patch(`/profiles/${profileId}`, data);
    return mapProfile(doc);
}
export async function getMyRoles(userId) {
    const where = buildWhereParams({ user: { equals: userId } });
    const result = await get(`/user-roles?${where}&limit=100&depth=0`);
    return result.docs.map((r) => r.role);
}
/** The municipality this user administers (their "municipality_admin" user-role), if any.
 * Distinct from their home municipality (profile.municipality_id) — a superadmin can grant
 * municipality_admin for an obec the person doesn't personally live in. */
export async function getMyAdministeredMunicipalityId(userId) {
    const where = buildWhereParams({ user: { equals: userId }, role: { equals: "municipality_admin" } });
    const result = await get(`/user-roles?${where}&limit=1&depth=0`);
    const row = result.docs[0];
    if (!row)
        return null;
    return String(typeof row.municipality === "object" ? row.municipality.id : row.municipality);
}
async function getMyRoleMunicipalityIds(userId, role) {
    const where = buildWhereParams({ user: { equals: userId }, role: { equals: role } });
    const result = await get(`/user-roles?${where}&limit=100&depth=0`);
    return result.docs.map((r) => String(typeof r.municipality === "object" ? r.municipality.id : r.municipality));
}
/** Every municipality this user administers (all of their "municipality_admin" user-roles). */
export function getMyAdministeredMunicipalityIds(userId) {
    return getMyRoleMunicipalityIds(userId, "municipality_admin");
}
/** Every municipality where this user holds the "organizer" role. */
export function getMyOrganizerMunicipalityIds(userId) {
    return getMyRoleMunicipalityIds(userId, "organizer");
}
/** The organizer-role request(s) this user has made — for showing pending/approved/rejected
 * status on their profile (brief §3 "Upozornění jde uživateli v obou případech"). */
export async function getMyOrganizerRequests(userId) {
    const where = buildWhereParams({ user: { equals: userId } });
    const query = buildQuery({ sort: "-createdAt", depth: 0, limit: 50 });
    const result = await get(`/organizer-requests?${where}&${query}`);
    return result.docs.map((r) => ({
        id: String(r.id),
        status: r.status,
        municipality_id: toId(r.municipality),
    }));
}
export async function requestOrganizerRole(userId, municipalityId) {
    await post("/organizer-requests", { user: Number(userId), municipality: Number(municipalityId) });
}
export async function requestVolunteerFlag(eventId, userId) {
    await post("/volunteer-flag-requests", { event: Number(eventId), requestedBy: Number(userId) });
}
// --- Consents / notification preferences ------------------------------------------------
const CONSENT_VERSION = "1.0";
/** Whether the user currently has an active (non-revoked) marketing consent. */
export async function getMarketingConsent(userId) {
    const where = buildWhereParams({ user: { equals: userId }, type: { equals: "marketing" } });
    const query = buildQuery({ sort: "-createdAt", limit: 1, depth: 0 });
    const result = await get(`/consents?${where}&${query}`);
    const latest = result.docs[0];
    return Boolean(latest && !latest.revokedAt);
}
/** Grants a fresh marketing consent, or revokes the current active one. */
export async function setMarketingConsent(userId, enabled) {
    if (enabled) {
        await post("/consents", {
            user: Number(userId),
            type: "marketing",
            version: CONSENT_VERSION,
            grantedAt: new Date().toISOString(),
        });
        return;
    }
    const where = buildWhereParams({ user: { equals: userId }, type: { equals: "marketing" } });
    const query = buildQuery({ sort: "-createdAt", limit: 1, depth: 0 });
    const result = await get(`/consents?${where}&${query}`);
    const active = result.docs.find((c) => !c.revokedAt);
    if (active) {
        await patch(`/consents/${active.id}`, { revokedAt: new Date().toISOString() });
    }
}
export async function getMyNotifications(userId) {
    const where = buildWhereParams({ user: { equals: userId } });
    const query = buildQuery({ sort: "-createdAt", depth: 0, limit: 100 });
    const result = await get(`/notifications?${where}&${query}`);
    return result.docs.map((n) => ({
        id: String(n.id),
        title: n.title,
        message: n.message,
        link: n.link || null,
        read: Boolean(n.readAt),
        created_at: n.createdAt,
    }));
}
export async function getUnreadNotificationCount(userId) {
    const where = buildWhereParams({ user: { equals: userId }, readAt: { exists: false } });
    const result = await get(`/notifications?${where}&depth=0&limit=0`);
    return result.totalDocs;
}
export async function markNotificationRead(notificationId) {
    await patch(`/notifications/${notificationId}`, { readAt: new Date().toISOString() });
}
