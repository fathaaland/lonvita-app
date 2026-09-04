/**
 * Query functions for the superadmin (platform-level, Users.role === 'admin') dashboard at
 * /superadmin — creating municipalities and managing users/roles across all of them. Distinct
 * from admin-queries.ts, which is scoped to a single municipality's admin dashboard.
 */
import { del, get, post } from "./client";

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

/** Superadmin-only account provisioning — creates the user, their profile, and a
 * "participant" role in the chosen municipality via a dedicated server route (Users.create
 * is otherwise locked to the /api/auth/register self-signup flow). */
export async function createUserAsSuperAdmin(input: {
  email: string;
  password: string;
  fullName: string;
  municipalityId: string;
}): Promise<void> {
  await post("/superadmin/create-user", {
    email: input.email,
    password: input.password,
    fullName: input.fullName,
    municipality: Number(input.municipalityId),
  });
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
