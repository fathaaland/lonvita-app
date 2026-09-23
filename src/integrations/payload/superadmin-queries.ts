/**
 * Query functions for the superadmin (platform-level, Users.role === 'admin') dashboard at
 * /superadmin — creating municipalities and managing users/roles across all of them. Distinct
 * from admin-queries.ts, which is scoped to a single municipality's admin dashboard.
 */
import { buildQuery, buildWhereParams, del, get, patch, post } from "./client";

import type { PayloadListResponse } from "./client";
import type { OrganizerRequestAdminRow, VolunteerFlagRequestAdminRow } from "./admin-queries";
import type { EventRow, RegistrationRow } from "@/lib/analytics";
import { computeReportMetrics, type ReportMetrics, type ProfileWithDob } from "@/lib/report";
import type { AnyOrganizationType, OrganizationType } from "@/lib/organizations";

const toId = (value: number | { id: number } | null | undefined): string | null => {
  if (value == null) return null;
  return String(typeof value === "object" ? value.id : value);
};

// --- Municipalities ---------------------------------------------------------------------

export type MunicipalityRow = {
  id: string;
  name: string;
  description: string | null;
};

type PayloadMunicipality = {
  id: number;
  name: string;
  description?: string | null;
};

export async function listMunicipalitiesForSuperAdmin(): Promise<MunicipalityRow[]> {
  const result = await get<PayloadListResponse<PayloadMunicipality>>("/municipalities?sort=name&limit=500");
  return result.docs.map((m) => ({
    id: String(m.id),
    name: m.name,
    description: m.description ?? null,
  }));
}

export async function createMunicipality(input: {
  name: string;
  description?: string;
  lat: number;
  lng: number;
}): Promise<MunicipalityRow> {
  const doc = await post<PayloadMunicipality>("/municipalities", input);
  return {
    id: String(doc.id),
    name: doc.name,
    description: doc.description ?? null,
  };
}

export async function updateMunicipality(
  municipalityId: string,
  input: { name: string; description?: string; lat: number; lng: number },
): Promise<MunicipalityRow> {
  const doc = await patch<PayloadMunicipality>(`/municipalities/${municipalityId}`, input);
  return {
    id: String(doc.id),
    name: doc.name,
    description: doc.description ?? null,
  };
}

export async function deleteMunicipality(municipalityId: string): Promise<void> {
  await del(`/municipalities/${municipalityId}`);
}

// --- Users + community roles -------------------------------------------------------------

export type Gender = "zena" | "muz" | "jine" | "neuvedeno";

export type CommunityRoleEntry = {
  userRoleId: string;
  role: "participant" | "municipality_admin" | "organizer" | "prescriber";
  municipalityId: string;
  municipalityName: string;
};

export type PlatformUserRow = {
  id: string;
  email: string;
  platformRole: "admin" | "user";
  /** null when the account has no profile row yet — nothing to edit in that case. */
  profileId: string | null;
  fullName: string | null;
  homeMunicipalityId: string | null;
  homeMunicipalityName: string | null;
  dateOfBirth: string | null;
  gender: Gender;
  phone: string | null;
  interestIds: string[];
  communityRoles: CommunityRoleEntry[];
};

type PayloadUserRaw = { id: number; email: string; role: "admin" | "user"; createdAt: string };
type PayloadProfileRaw = {
  id: number;
  user: number | { id: number };
  fullName: string;
  municipality?: number | { id: number } | null;
  dateOfBirth?: string | null;
  gender?: Gender | null;
  phone?: string | null;
  interests?: (number | { id: number })[] | null;
};
type PayloadUserRoleRaw = { id: number; user: number | { id: number }; municipality: number | { id: number }; role: CommunityRoleEntry["role"] };

export async function listAllUsersForSuperAdmin(): Promise<PlatformUserRow[]> {
  const [usersRes, profilesRes, rolesRes, munisRes] = await Promise.all([
    get<PayloadListResponse<PayloadUserRaw>>("/users?sort=email&depth=0&limit=1000"),
    get<PayloadListResponse<PayloadProfileRaw>>("/profiles?depth=0&limit=1000"),
    get<PayloadListResponse<PayloadUserRoleRaw>>("/user-roles?depth=0&limit=2000"),
    get<PayloadListResponse<PayloadMunicipality>>("/municipalities?depth=0&limit=500"),
  ]);

  const muniNameById = new Map(munisRes.docs.map((m) => [String(m.id), m.name]));
  const profileByUserId = new Map(profilesRes.docs.map((p) => [toId(p.user)!, p]));
  const rolesByUserId = new Map<string, PayloadUserRoleRaw[]>();
  for (const r of rolesRes.docs) {
    const uid = toId(r.user)!;
    if (!rolesByUserId.has(uid)) rolesByUserId.set(uid, []);
    rolesByUserId.get(uid)!.push(r);
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
      interestIds: (profile?.interests ?? []).map(toId).filter((v): v is string => Boolean(v)),
      communityRoles: (rolesByUserId.get(uid) ?? []).map((r) => {
        const municipalityId = toId(r.municipality)!;
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
export async function createUserAsSuperAdmin(input: {
  email: string;
  password: string;
  fullName: string;
  /** null = "bez obce". */
  municipalityId: string | null;
  dateOfBirth: string | null;
  gender: Gender;
  phone: string | null;
  interestIds: string[];
}): Promise<void> {
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
export async function updateUserAsSuperAdmin(
  profileId: string,
  input: {
    fullName: string;
    /** null = "bez obce". */
    municipalityId: string | null;
    dateOfBirth: string | null;
    gender: Gender;
    phone: string | null;
    interestIds: string[];
  },
): Promise<void> {
  await patch(`/profiles/${profileId}`, {
    fullName: input.fullName,
    municipality: input.municipalityId ? Number(input.municipalityId) : null,
    dateOfBirth: input.dateOfBirth,
    gender: input.gender,
    phone: input.phone,
    interests: input.interestIds.map(Number),
  });
}

export async function deleteUserAsSuperAdmin(userId: string): Promise<void> {
  await del(`/users/${userId}`);
}

// --- Events -------------------------------------------------------------------------------

export type SuperAdminEventRow = {
  id: string;
  title: string;
  dateTimeIso: string;
  municipalityName: string;
};

type PayloadEventForSuperAdmin = {
  id: number;
  title: string;
  dateTime: string;
  municipality: number | { id: number; name: string };
};

/** Every event platform-wide (across every obec) — for the superadmin "Akce" list. REST calls
 * go through real access control (unlike the Local API's overrideAccess default), so this only
 * ever returns non-deleted events regardless of who's asking (Events.access.read). */
export async function listAllEventsForSuperAdmin(): Promise<SuperAdminEventRow[]> {
  const query = buildQuery({ sort: "-dateTime", depth: 1, limit: 1000 });
  const result = await get<PayloadListResponse<PayloadEventForSuperAdmin>>(`/events?${query}`);
  return result.docs.map((e) => ({
    id: String(e.id),
    title: e.title,
    dateTimeIso: e.dateTime,
    municipalityName: typeof e.municipality === "object" ? e.municipality.name : "Neznámá obec",
  }));
}

export async function grantCommunityRole(
  userId: string,
  municipalityId: string,
  role: "municipality_admin",
): Promise<void> {
  await post("/user-roles", { user: Number(userId), municipality: Number(municipalityId), role });
}

export async function revokeCommunityRole(userRoleId: string): Promise<void> {
  await del(`/user-roles/${userRoleId}`);
}

// --- Organizations ----------------------------------------------------------------------
// What organizers run and co-organize events as (Organizations.ts). Owner and obec are fixed once
// created; creating one grants its owner the organizer role, deleting it takes the role away.

export type SuperAdminOrganizationRow = {
  id: string;
  name: string;
  type: AnyOrganizationType;
  /** Null for the obec's own organization — it belongs to the obec, not to a person. */
  ownerId: string | null;
  municipalityId: string;
};

type PayloadOrganizationRaw = {
  id: number;
  name: string;
  type: AnyOrganizationType;
  owner?: number | { id: number } | null;
  municipality: number | { id: number };
};

const toOrganizationRow = (o: PayloadOrganizationRaw): SuperAdminOrganizationRow => ({
  id: String(o.id),
  name: o.name,
  type: o.type,
  ownerId: toId(o.owner),
  municipalityId: toId(o.municipality)!,
});

export async function listOrganizationsForSuperAdmin(): Promise<SuperAdminOrganizationRow[]> {
  const result = await get<PayloadListResponse<PayloadOrganizationRaw>>("/organizations?sort=name&depth=0&limit=2000");
  return result.docs.map(toOrganizationRow);
}

export async function createOrganizationAsSuperAdmin(input: {
  name: string;
  type: OrganizationType;
  ownerId: string;
  municipalityId: string;
}): Promise<void> {
  await post("/organizations", {
    name: input.name,
    type: input.type,
    owner: Number(input.ownerId),
    municipality: Number(input.municipalityId),
  });
}

export async function updateOrganizationAsSuperAdmin(
  organizationId: string,
  input: { name: string; type?: OrganizationType },
): Promise<void> {
  // The obec's own organization only gets renamed — its type is fixed.
  await patch(`/organizations/${organizationId}`, input);
}

export async function deleteOrganizationAsSuperAdmin(organizationId: string): Promise<void> {
  await del(`/organizations/${organizationId}`);
}

// --- Cross-municipality request hub (US-S-04) -------------------------------------------
// OrganizerRequests/VolunteerFlagRequests are otherwise only visible per-obec (RequestsTable,
// scoped by admin-queries.ts). These pull every pending request platform-wide, so the decide
// actions themselves are reused as-is from admin-queries.ts (same PATCH call either way).

export type SuperAdminOrganizerRequestRow = OrganizerRequestAdminRow & {
  municipality_id: string;
  municipality_name: string;
};

type PayloadOrganizerRequestSuper = {
  id: number;
  user: number | { id: number };
  municipality: number | { id: number };
  status: string;
  reason?: string | null;
  organizationName?: string | null;
  organizationType?: OrganizationType | null;
  createdAt: string;
};

export async function getAllOrganizerRequestsForSuperAdmin(): Promise<SuperAdminOrganizerRequestRow[]> {
  const where = buildWhereParams({ status: { equals: "pending" } });
  const query = buildQuery({ depth: 0, sort: "createdAt", limit: 1000 });
  const [result, munisRes] = await Promise.all([
    get<PayloadListResponse<PayloadOrganizerRequestSuper>>(`/organizer-requests?${where}&${query}`),
    get<PayloadListResponse<PayloadMunicipality>>("/municipalities?depth=0&limit=500"),
  ]);
  const muniNameById = new Map(munisRes.docs.map((m) => [String(m.id), m.name]));

  const userIds = Array.from(new Set(result.docs.map((r) => toId(r.user)).filter((v): v is string => Boolean(v))));
  const nameById = new Map<string, string>();
  if (userIds.length) {
    const profileWhere = buildWhereParams({ user: { in: userIds } });
    const profiles = await get<PayloadListResponse<{ user: number | { id: number }; fullName: string }>>(
      `/profiles?${profileWhere}&depth=0&limit=500`,
    );
    for (const p of profiles.docs) {
      const uid = toId(p.user);
      if (uid) nameById.set(uid, p.fullName);
    }
  }

  return result.docs.map((r) => {
    const municipalityId = toId(r.municipality)!;
    return {
      id: String(r.id),
      user_id: toId(r.user)!,
      full_name: nameById.get(toId(r.user) ?? "") ?? "Účastník",
      status: r.status as OrganizerRequestAdminRow["status"],
      reason: r.reason ?? null,
      organization_name: r.organizationName ?? null,
      organization_type: r.organizationType ?? null,
      created_at: r.createdAt,
      municipality_id: municipalityId,
      municipality_name: muniNameById.get(municipalityId) ?? "Neznámá obec",
    };
  });
}

export type SuperAdminVolunteerFlagRequestRow = VolunteerFlagRequestAdminRow & {
  municipality_id: string;
  municipality_name: string;
};

type PayloadVolunteerFlagRequestSuper = {
  id: number;
  event: number | { id: number; title?: string; municipality?: number | { id: number } };
  requestedBy: number | { id: number };
  status: string;
  createdAt: string;
};

export async function getAllVolunteerFlagRequestsForSuperAdmin(): Promise<SuperAdminVolunteerFlagRequestRow[]> {
  const where = buildWhereParams({ status: { equals: "pending" } });
  const query = buildQuery({ depth: 1, sort: "createdAt", limit: 1000 });
  const [result, munisRes] = await Promise.all([
    get<PayloadListResponse<PayloadVolunteerFlagRequestSuper>>(`/volunteer-flag-requests?${where}&${query}`),
    get<PayloadListResponse<PayloadMunicipality>>("/municipalities?depth=0&limit=500"),
  ]);
  const muniNameById = new Map(munisRes.docs.map((m) => [String(m.id), m.name]));

  const userIds = Array.from(new Set(result.docs.map((r) => toId(r.requestedBy)).filter((v): v is string => Boolean(v))));
  const nameById = new Map<string, string>();
  if (userIds.length) {
    const profileWhere = buildWhereParams({ user: { in: userIds } });
    const profiles = await get<PayloadListResponse<{ user: number | { id: number }; fullName: string }>>(
      `/profiles?${profileWhere}&depth=0&limit=500`,
    );
    for (const p of profiles.docs) {
      const uid = toId(p.user);
      if (uid) nameById.set(uid, p.fullName);
    }
  }

  return result.docs.map((r) => {
    const municipalityId = toId(typeof r.event === "object" ? r.event.municipality : undefined) ?? "";
    return {
      id: String(r.id),
      event_id: toId(r.event)!,
      event_title: typeof r.event === "object" ? (r.event.title ?? "") : "",
      requested_by_name: nameById.get(toId(r.requestedBy) ?? "") ?? "Organizátor",
      status: r.status as VolunteerFlagRequestAdminRow["status"],
      created_at: r.createdAt,
      municipality_id: municipalityId,
      municipality_name: muniNameById.get(municipalityId) ?? "Neznámá obec",
    };
  });
}

// --- Municipality comparison (US-S-07) ----------------------------------------------------
// Runs the same computeReportMetrics used per-obec in CommunityReport.tsx, once per
// municipality, to feed a side-by-side comparison table instead of one narrated report.

export type MunicipalityComparisonRow = {
  municipality_id: string;
  municipality_name: string;
  metrics: ReportMetrics;
};

type PayloadEventSuperFull = {
  id: number;
  title: string;
  dateTime: string;
  capacity: number;
  status: string;
  categories?: (number | { id: number })[] | null;
  organizer?: number | { id: number } | null;
  createdAt: string;
  isPaid?: boolean;
  priceCents?: number | null;
  isVolunteering?: boolean;
  municipality: number | { id: number };
};

type PayloadRegistrationSuperFull = {
  id: number;
  event: number | { id: number };
  user: number | { id: number };
  status: string;
  createdAt: string;
  attendanceStatus?: string;
};

type PayloadProfileSuperFull = {
  id: number;
  fullName: string;
  createdAt: string;
  dateOfBirth?: string | null;
  municipality?: number | { id: number } | null;
};

export async function getMunicipalityComparison(): Promise<MunicipalityComparisonRow[]> {
  const [munisRes, eventsRes, regsRes, profilesRes] = await Promise.all([
    get<PayloadListResponse<PayloadMunicipality>>("/municipalities?depth=0&limit=500"),
    get<PayloadListResponse<PayloadEventSuperFull>>("/events?depth=0&limit=5000"),
    get<PayloadListResponse<PayloadRegistrationSuperFull>>("/registrations?depth=0&limit=20000"),
    get<PayloadListResponse<PayloadProfileSuperFull>>("/profiles?depth=0&limit=20000"),
  ]);

  const eventsByMuni = new Map<string, EventRow[]>();
  const eventMuniById = new Map<string, string>();
  for (const e of eventsRes.docs) {
    const muniId = toId(e.municipality);
    if (!muniId) continue;
    const row: EventRow = {
      id: String(e.id),
      title: e.title,
      date_time: e.dateTime,
      capacity: e.capacity,
      status: e.status,
      category_ids: (e.categories ?? []).map(toId).filter((v): v is string => Boolean(v)),
      organizer_id: toId(e.organizer) ?? "",
      created_at: e.createdAt,
      is_paid: e.isPaid,
      price_cents: e.priceCents ?? null,
      is_volunteering: e.isVolunteering,
    };
    eventMuniById.set(row.id, muniId);
    if (!eventsByMuni.has(muniId)) eventsByMuni.set(muniId, []);
    eventsByMuni.get(muniId)!.push(row);
  }

  const regsByMuni = new Map<string, RegistrationRow[]>();
  for (const r of regsRes.docs) {
    const eventId = toId(r.event);
    const muniId = eventId ? eventMuniById.get(eventId) : undefined;
    if (!muniId) continue;
    const row: RegistrationRow = {
      id: String(r.id),
      event_id: eventId!,
      user_id: toId(r.user)!,
      status: r.status,
      created_at: r.createdAt,
      attendance_status: (r.attendanceStatus ?? "not_marked") as RegistrationRow["attendance_status"],
    };
    if (!regsByMuni.has(muniId)) regsByMuni.set(muniId, []);
    regsByMuni.get(muniId)!.push(row);
  }

  const profilesByMuni = new Map<string, ProfileWithDob[]>();
  for (const p of profilesRes.docs) {
    const muniId = toId(p.municipality);
    if (!muniId) continue;
    const row: ProfileWithDob = {
      id: String(p.id),
      full_name: p.fullName,
      created_at: p.createdAt,
      date_of_birth: p.dateOfBirth ?? null,
    };
    if (!profilesByMuni.has(muniId)) profilesByMuni.set(muniId, []);
    profilesByMuni.get(muniId)!.push(row);
  }

  return munisRes.docs.map((m) => {
    const muniId = String(m.id);
    const metrics = computeReportMetrics(
      eventsByMuni.get(muniId) ?? [],
      regsByMuni.get(muniId) ?? [],
      profilesByMuni.get(muniId) ?? [],
    );
    return { municipality_id: muniId, municipality_name: m.name, metrics };
  });
}
