/**
 * Query functions for the superadmin (platform-level, Users.role === 'admin') dashboard at
 * /superadmin — creating municipalities and managing users/roles across all of them. Distinct
 * from admin-queries.ts, which is scoped to a single municipality's admin dashboard.
 */
import { buildQuery, buildWhereParams, del, get, patch, post } from "./client";
import { computeReportMetrics } from "@/lib/report";
const toId = (value) => {
    if (value == null)
        return null;
    return String(typeof value === "object" ? value.id : value);
};
export async function listMunicipalitiesForSuperAdmin() {
    const result = await get("/municipalities?sort=name&limit=500");
    return result.docs.map((m) => ({
        id: String(m.id),
        name: m.name,
        description: m.description ?? null,
    }));
}
export async function createMunicipality(input) {
    const doc = await post("/municipalities", input);
    return {
        id: String(doc.id),
        name: doc.name,
        description: doc.description ?? null,
    };
}
export async function updateMunicipality(municipalityId, input) {
    const doc = await patch(`/municipalities/${municipalityId}`, input);
    return {
        id: String(doc.id),
        name: doc.name,
        description: doc.description ?? null,
    };
}
export async function deleteMunicipality(municipalityId) {
    await del(`/municipalities/${municipalityId}`);
}
export async function listAllUsersForSuperAdmin() {
    const [usersRes, profilesRes, rolesRes, munisRes] = await Promise.all([
        get("/users?sort=email&depth=0&limit=1000"),
        get("/profiles?depth=0&limit=1000"),
        get("/user-roles?depth=0&limit=2000"),
        get("/municipalities?depth=0&limit=500"),
    ]);
    const muniNameById = new Map(munisRes.docs.map((m) => [String(m.id), m.name]));
    const profileByUserId = new Map(profilesRes.docs.map((p) => [toId(p.user), p]));
    const rolesByUserId = new Map();
    for (const r of rolesRes.docs) {
        const uid = toId(r.user);
        if (!rolesByUserId.has(uid))
            rolesByUserId.set(uid, []);
        rolesByUserId.get(uid).push(r);
    }
    return usersRes.docs.map((u) => {
        const uid = String(u.id);
        const profile = profileByUserId.get(uid);
        const homeMuniId = profile ? toId(profile.municipality) : null;
        return {
            id: uid,
            email: u.email,
            platformRole: u.role,
            profileId: profile ? String(profile.id) : null,
            fullName: profile?.fullName ?? null,
            homeMunicipalityId: homeMuniId,
            homeMunicipalityName: homeMuniId ? (muniNameById.get(homeMuniId) ?? null) : null,
            dateOfBirth: profile?.dateOfBirth ? profile.dateOfBirth.slice(0, 10) : null,
            gender: profile?.gender ?? "neuvedeno",
            phone: profile?.phone ?? null,
            interestIds: (profile?.interests ?? []).map(toId).filter((v) => Boolean(v)),
            communityRoles: (rolesByUserId.get(uid) ?? []).map((r) => {
                const municipalityId = toId(r.municipality);
                return {
                    userRoleId: String(r.id),
                    role: r.role,
                    municipalityId,
                    municipalityName: muniNameById.get(municipalityId) ?? "Neznámá obec",
                };
            }),
        };
    });
}
/** Superadmin-only account provisioning — creates the user, their full profile (the same data
 * registration + onboarding collect) and a "participant" role in the chosen municipality via a
 * dedicated server route (Users.create is otherwise locked to the /api/auth/register flow). */
export async function createUserAsSuperAdmin(input) {
    await post("/superadmin/create-user", {
        email: input.email,
        password: input.password,
        fullName: input.fullName,
        municipality: input.municipalityId ? Number(input.municipalityId) : null,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        phone: input.phone,
        interests: input.interestIds.map(Number),
    });
}
/** Edits an existing account's profile from the Uživatelé tab's pencil. Deliberately limited to
 * profile data: the platform role is locked at the collection (Users.role field access), and the
 * e-mail is the key a Google sign-in links on (see resolveGoogleUser), so changing it here would
 * orphan the account on next sign-in. Community roles have their own tab. */
export async function updateUserAsSuperAdmin(profileId, input) {
    await patch(`/profiles/${profileId}`, {
        fullName: input.fullName,
        municipality: input.municipalityId ? Number(input.municipalityId) : null,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        phone: input.phone,
        interests: input.interestIds.map(Number),
    });
}
export async function deleteUserAsSuperAdmin(userId) {
    await del(`/users/${userId}`);
}
/** Every event platform-wide (across every obec) — for the superadmin "Akce" list. REST calls
 * go through real access control (unlike the Local API's overrideAccess default), so this only
 * ever returns non-deleted events regardless of who's asking (Events.access.read). */
export async function listAllEventsForSuperAdmin() {
    const query = buildQuery({ sort: "-dateTime", depth: 1, limit: 1000 });
    const result = await get(`/events?${query}`);
    return result.docs.map((e) => ({
        id: String(e.id),
        title: e.title,
        dateTimeIso: e.dateTime,
        municipalityName: typeof e.municipality === "object" ? e.municipality.name : "Neznámá obec",
    }));
}
export async function grantCommunityRole(userId, municipalityId, role) {
    await post("/user-roles", { user: Number(userId), municipality: Number(municipalityId), role });
}
export async function revokeCommunityRole(userRoleId) {
    await del(`/user-roles/${userRoleId}`);
}
export async function getAllOrganizerRequestsForSuperAdmin() {
    const where = buildWhereParams({ status: { equals: "pending" } });
    const query = buildQuery({ depth: 0, sort: "createdAt", limit: 1000 });
    const [result, munisRes] = await Promise.all([
        get(`/organizer-requests?${where}&${query}`),
        get("/municipalities?depth=0&limit=500"),
    ]);
    const muniNameById = new Map(munisRes.docs.map((m) => [String(m.id), m.name]));
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
    return result.docs.map((r) => {
        const municipalityId = toId(r.municipality);
        return {
            id: String(r.id),
            user_id: toId(r.user),
            full_name: nameById.get(toId(r.user) ?? "") ?? "Účastník",
            status: r.status,
            created_at: r.createdAt,
            municipality_id: municipalityId,
            municipality_name: muniNameById.get(municipalityId) ?? "Neznámá obec",
        };
    });
}
export async function getAllVolunteerFlagRequestsForSuperAdmin() {
    const where = buildWhereParams({ status: { equals: "pending" } });
    const query = buildQuery({ depth: 1, sort: "createdAt", limit: 1000 });
    const [result, munisRes] = await Promise.all([
        get(`/volunteer-flag-requests?${where}&${query}`),
        get("/municipalities?depth=0&limit=500"),
    ]);
    const muniNameById = new Map(munisRes.docs.map((m) => [String(m.id), m.name]));
    const userIds = Array.from(new Set(result.docs.map((r) => toId(r.requestedBy)).filter((v) => Boolean(v))));
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
    return result.docs.map((r) => {
        const municipalityId = toId(typeof r.event === "object" ? r.event.municipality : undefined) ?? "";
        return {
            id: String(r.id),
            event_id: toId(r.event),
            event_title: typeof r.event === "object" ? (r.event.title ?? "") : "",
            requested_by_name: nameById.get(toId(r.requestedBy) ?? "") ?? "Organizátor",
            status: r.status,
            created_at: r.createdAt,
            municipality_id: municipalityId,
            municipality_name: muniNameById.get(municipalityId) ?? "Neznámá obec",
        };
    });
}
export async function getMunicipalityComparison() {
    const [munisRes, eventsRes, regsRes, profilesRes] = await Promise.all([
        get("/municipalities?depth=0&limit=500"),
        get("/events?depth=0&limit=5000"),
        get("/registrations?depth=0&limit=20000"),
        get("/profiles?depth=0&limit=20000"),
    ]);
    const eventsByMuni = new Map();
    const eventMuniById = new Map();
    for (const e of eventsRes.docs) {
        const muniId = toId(e.municipality);
        if (!muniId)
            continue;
        const row = {
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
        };
        eventMuniById.set(row.id, muniId);
        if (!eventsByMuni.has(muniId))
            eventsByMuni.set(muniId, []);
        eventsByMuni.get(muniId).push(row);
    }
    const regsByMuni = new Map();
    for (const r of regsRes.docs) {
        const eventId = toId(r.event);
        const muniId = eventId ? eventMuniById.get(eventId) : undefined;
        if (!muniId)
            continue;
        const row = {
            id: String(r.id),
            event_id: eventId,
            user_id: toId(r.user),
            status: r.status,
            created_at: r.createdAt,
            attendance_status: (r.attendanceStatus ?? "not_marked"),
        };
        if (!regsByMuni.has(muniId))
            regsByMuni.set(muniId, []);
        regsByMuni.get(muniId).push(row);
    }
    const profilesByMuni = new Map();
    for (const p of profilesRes.docs) {
        const muniId = toId(p.municipality);
        if (!muniId)
            continue;
        const row = {
            id: String(p.id),
            full_name: p.fullName,
            created_at: p.createdAt,
            date_of_birth: p.dateOfBirth ?? null,
        };
        if (!profilesByMuni.has(muniId))
            profilesByMuni.set(muniId, []);
        profilesByMuni.get(muniId).push(row);
    }
    return munisRes.docs.map((m) => {
        const muniId = String(m.id);
        const metrics = computeReportMetrics(eventsByMuni.get(muniId) ?? [], regsByMuni.get(muniId) ?? [], profilesByMuni.get(muniId) ?? []);
        return { municipality_id: muniId, municipality_name: m.name, metrics };
    });
}
