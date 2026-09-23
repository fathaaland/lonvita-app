/**
 * Query functions specific to the Admin dashboard (src/pages/Admin.tsx and
 * src/components/admin/*). Shaped to match src/lib/analytics.ts's EventRow/
 * RegistrationRow/CategoryRow/ProfileRow interfaces directly, since those pure
 * client-side analytics functions are unaware of Payload and expect that exact shape.
 */
import { buildQuery, buildWhereParams, del, get, patch } from "./client";

import type { PayloadListResponse } from "./client";
import type { EventRow, RegistrationRow, CategoryRow, ProfileRow, FeedbackRow } from "@/lib/analytics";
import type { ProfileWithDob } from "@/lib/report";
import type { OrganizationType } from "@/lib/organizations";

const toId = (value: number | { id: number } | null | undefined): string | null => {
  if (value == null) return null;
  return String(typeof value === "object" ? value.id : value);
};

type PayloadEventAdmin = {
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
};

export async function getMunicipalityEventsForAdmin(municipalityId: string): Promise<EventRow[]> {
  const where = buildWhereParams({ municipality: { equals: municipalityId } });
  const query = buildQuery({ depth: 0, limit: 1000 });
  const result = await get<PayloadListResponse<PayloadEventAdmin>>(`/events?${where}&${query}`);
  return result.docs.map((e) => ({
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
  }));
}

type PayloadRegistrationAdmin = {
  id: number;
  event: number | { id: number };
  user: number | { id: number };
  status: string;
  createdAt: string;
  attendanceStatus?: string;
};

export async function getRegistrationsForEventIds(eventIds: string[]): Promise<RegistrationRow[]> {
  if (eventIds.length === 0) return [];
  const where = buildWhereParams({ event: { in: eventIds } });
  const query = buildQuery({ depth: 0, limit: 5000 });
  const result = await get<PayloadListResponse<PayloadRegistrationAdmin>>(`/registrations?${where}&${query}`);
  return result.docs.map((r) => ({
    id: String(r.id),
    event_id: toId(r.event)!,
    user_id: toId(r.user)!,
    status: r.status,
    created_at: r.createdAt,
    attendance_status: (r.attendanceStatus ?? "not_marked") as RegistrationRow["attendance_status"],
  }));
}

type PayloadEventFeedbackAdmin = {
  id: number;
  registration: number | { id: number };
  satisfactionRating: number;
  feltWelcomeRating?: number | null;
}

/** Feedback for every registration on these events — joined through `registration.event`,
 * since EventFeedback only relates to a registration, not directly to an event. Feeds the
 * admin overview's average-rating KPIs (US-A-08). */
export async function getFeedbackForEventIds(eventIds: string[]): Promise<FeedbackRow[]> {
  if (eventIds.length === 0) return [];
  const where = buildWhereParams({ "registration.event": { in: eventIds } });
  const query = buildQuery({ depth: 0, limit: 5000 });
  const result = await get<PayloadListResponse<PayloadEventFeedbackAdmin>>(`/event-feedback?${where}&${query}`);
  return result.docs.map((f) => ({
    id: String(f.id),
    registration_id: toId(f.registration)!,
    satisfaction_rating: f.satisfactionRating,
    felt_welcome_rating: f.feltWelcomeRating ?? null,
  }));
}

type PayloadCategoryAdmin = { id: number; name: string; icon?: string | null; color?: string | null };

export async function getAllCategoriesForAdmin(): Promise<CategoryRow[]> {
  const result = await get<PayloadListResponse<PayloadCategoryAdmin>>("/event-categories?limit=200");
  return result.docs.map((c) => ({ id: String(c.id), name: c.name, icon: c.icon ?? "", color: c.color ?? "" }));
}

type PayloadProfileAdmin = { id: number; fullName: string; createdAt: string; dateOfBirth?: string | null };

export async function getMunicipalityProfilesForAdmin(municipalityId: string): Promise<ProfileWithDob[]> {
  const where = buildWhereParams({ municipality: { equals: municipalityId } });
  const query = buildQuery({ depth: 0, limit: 2000 });
  const result = await get<PayloadListResponse<PayloadProfileAdmin>>(`/profiles?${where}&${query}`);
  return result.docs.map((p) => ({
    id: String(p.id),
    full_name: p.fullName,
    created_at: p.createdAt,
    date_of_birth: p.dateOfBirth ?? null,
  })) as ProfileWithDob[];
}

/** Cancels an event (soft-delete: sets deletedAt + status "cancelled") rather than hard-
 * deleting the row — works regardless of existing registrations, and triggers the
 * backend's notifyRegistrantsOnCancellation hook so pending/approved attendees are told.
 * Access-controlled to platform superadmins and the event's own municipality admin. */
export async function deleteEvent(eventId: string): Promise<void> {
  await patch(`/events/${eventId}`, { deletedAt: new Date().toISOString(), status: "cancelled" });
}

/** Removes an already-granted "Dobrovolnictví" flag directly — a plain field flip, distinct
 * from deciding a pending VolunteerFlagRequests row (US-A-09). */
export async function removeVolunteeringFlag(eventId: string): Promise<void> {
  await patch(`/events/${eventId}`, { isVolunteering: false });
}

// --- Žádosti: role organizátora + příznak Dobrovolnictví ---------------------------------

export type OrganizerRequestAdminRow = {
  id: string;
  user_id: string;
  full_name: string;
  status: "pending" | "approved" | "rejected";
  /** The applicant's reason — null on requests filed before it was asked for. */
  reason: string | null;
  /** Who they'll organize as once approved — null on requests filed before it was asked for. */
  organization_name: string | null;
  organization_type: OrganizationType | null;
  created_at: string;
};

type PayloadOrganizerRequestAdmin = {
  id: number;
  user: number | { id: number };
  status: string;
  reason?: string | null;
  organizationName?: string | null;
  organizationType?: OrganizationType | null;
  createdAt: string;
};

export async function getOrganizerRequestsForAdmin(municipalityId: string): Promise<OrganizerRequestAdminRow[]> {
  const where = buildWhereParams({ municipality: { equals: municipalityId }, status: { equals: "pending" } });
  const query = buildQuery({ depth: 0, sort: "createdAt", limit: 200 });
  const result = await get<PayloadListResponse<PayloadOrganizerRequestAdmin>>(`/organizer-requests?${where}&${query}`);

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

  return result.docs.map((r) => ({
    id: String(r.id),
    user_id: toId(r.user)!,
    full_name: nameById.get(toId(r.user) ?? "") ?? "Účastník",
    status: r.status as OrganizerRequestAdminRow["status"],
    reason: r.reason ?? null,
    organization_name: r.organizationName ?? null,
    organization_type: r.organizationType ?? null,
    created_at: r.createdAt,
  }));
}

export async function decideOrganizerRequest(requestId: string, approve: boolean): Promise<void> {
  await patch(`/organizer-requests/${requestId}`, { status: approve ? "approved" : "rejected" });
}

export type VolunteerFlagRequestAdminRow = {
  id: string;
  event_id: string;
  event_title: string;
  requested_by_name: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

type PayloadVolunteerFlagRequestAdmin = {
  id: number;
  event: number | { id: number; title?: string };
  requestedBy: number | { id: number };
  status: string;
  createdAt: string;
};

/** Pending volunteering-flag requests for events in this municipality — filtered client-side
 * by event.municipality since the collection has no direct municipality field of its own. */
export async function getVolunteerFlagRequestsForAdmin(municipalityId: string): Promise<VolunteerFlagRequestAdminRow[]> {
  const query = buildQuery({ depth: 1, sort: "createdAt", limit: 200 });
  const where = buildWhereParams({ status: { equals: "pending" } });
  const result = await get<PayloadListResponse<PayloadVolunteerFlagRequestAdmin & { event: { id: number; title: string; municipality: number | { id: number } } }>>(
    `/volunteer-flag-requests?${where}&${query}`,
  );
  const filtered = result.docs.filter((r) => toId(r.event?.municipality) === municipalityId);

  const userIds = Array.from(new Set(filtered.map((r) => toId(r.requestedBy)).filter((v): v is string => Boolean(v))));
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

  return filtered.map((r) => ({
    id: String(r.id),
    event_id: toId(r.event)!,
    event_title: r.event.title,
    requested_by_name: nameById.get(toId(r.requestedBy) ?? "") ?? "Organizátor",
    status: r.status as VolunteerFlagRequestAdminRow["status"],
    created_at: r.createdAt,
  }));
}

export async function decideVolunteerFlagRequest(requestId: string, approve: boolean): Promise<void> {
  await patch(`/volunteer-flag-requests/${requestId}`, { status: approve ? "approved" : "rejected" });
}

export type CoOrganizingRequestAdminRow = {
  id: string;
  event_id: string;
  event_title: string;
  requested_by_name: string;
  municipality_id: string;
  created_at: string;
};

type PayloadCoOrganizingRequest = {
  id: number;
  event: number | { id: number } | null;
  eventTitle: string;
  municipality: number | { id: number };
  requestedBy: number | { id: number };
  createdAt: string;
};

/** Pending requests for the obec to co-organize an event — for one obec, or (a superadmin,
 * no `municipalityId`) every obec. */
export async function getCoOrganizingRequestsForAdmin(municipalityId?: string): Promise<CoOrganizingRequestAdminRow[]> {
  const query = buildQuery({ depth: 0, sort: "createdAt", limit: 1000 });
  const where = buildWhereParams({
    status: { equals: "pending" },
    ...(municipalityId ? { municipality: { equals: municipalityId } } : {}),
  });
  const result = await get<PayloadListResponse<PayloadCoOrganizingRequest>>(`/co-organizing-requests?${where}&${query}`);

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

  return result.docs.map((r) => ({
    id: String(r.id),
    event_id: toId(r.event) ?? "",
    event_title: r.eventTitle,
    requested_by_name: nameById.get(toId(r.requestedBy) ?? "") ?? "Organizátor",
    municipality_id: toId(r.municipality)!,
    created_at: r.createdAt,
  }));
}

/** Approving puts the obec among the event's spolupořadatelé (CoOrganizingRequests applyDecision). */
export async function decideCoOrganizingRequest(requestId: string, approve: boolean): Promise<void> {
  await patch(`/co-organizing-requests/${requestId}`, { status: approve ? "approved" : "rejected" });
}

// --- Aktivní organizátoři (revoke role, US-A-09) ------------------------------------------

export type OrganizerRoleRow = {
  id: string;
  user_id: string;
  full_name: string;
};

type PayloadUserRoleAdmin = { id: number; user: number | { id: number }; role: string };

/** Users currently holding the "organizer" role in this municipality — mirrors the
 * superadmin panel's grant/revoke UI, but scoped to the admin's own obec. */
export async function getOrganizersForAdmin(municipalityId: string): Promise<OrganizerRoleRow[]> {
  const where = buildWhereParams({ municipality: { equals: municipalityId }, role: { equals: "organizer" } });
  const query = buildQuery({ depth: 0, sort: "createdAt", limit: 500 });
  const result = await get<PayloadListResponse<PayloadUserRoleAdmin>>(`/user-roles?${where}&${query}`);

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

  return result.docs.map((r) => ({
    id: String(r.id),
    user_id: toId(r.user)!,
    full_name: nameById.get(toId(r.user) ?? "") ?? "Organizátor",
  }));
}

export async function revokeOrganizerRole(userRoleId: string): Promise<void> {
  await del(`/user-roles/${userRoleId}`);
}
