/**
 * Query functions for the superadmin (platform-level, Users.role === 'admin') dashboard at
 * /superadmin — creating municipalities and managing users/roles across all of them. Distinct
 * from admin-queries.ts, which is scoped to a single municipality's admin dashboard.
 */
import { buildQuery, del, get, patch, post } from "./client";

import type { PayloadListResponse } from "./client";

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

export type CommunityRoleEntry = {
  userRoleId: string;
  role: "participant" | "municipality_admin" | "prescriber";
  municipalityId: string;
  municipalityName: string;
};

export type PlatformUserRow = {
  id: string;
  email: string;
  platformRole: "admin" | "user";
  fullName: string | null;
  homeMunicipalityName: string | null;
  communityRoles: CommunityRoleEntry[];
};

type PayloadUserRaw = { id: number; email: string; role: "admin" | "user"; createdAt: string };
type PayloadProfileRaw = { id: number; user: number | { id: number }; fullName: string; municipality?: number | { id: number } | null };
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
      fullName: profile?.fullName ?? null,
      homeMunicipalityName: homeMuniId ? (muniNameById.get(homeMuniId) ?? null) : null,
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
  gender: "zena" | "muz" | "jine" | "neuvedeno";
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

/** Platform role only (Users.role) — community roles (municipality_admin/organizer/…) are
 * managed via the Role tab's grant/revoke instead. */
export async function updateUserPlatformRole(userId: string, role: "admin" | "user"): Promise<void> {
  await patch(`/users/${userId}`, { role });
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
