/**
 * Query functions specific to the Admin dashboard (src/pages/Admin.tsx and
 * src/components/admin/*). Shaped to match src/lib/analytics.ts's EventRow/
 * RegistrationRow/CategoryRow/ProfileRow interfaces directly, since those pure
 * client-side analytics functions are unaware of Payload and expect that exact shape.
 */
import { buildQuery, buildWhereParams, del, get, patch, post } from "./client";

import type { PayloadListResponse } from "./client";
import type { EventRow, RegistrationRow, CategoryRow, ProfileRow, FeedbackRow } from "@/lib/analytics";
import type { ProfileWithDob } from "@/lib/report";
import type { OrganizationType } from "@/lib/organizations";

const toId = (value: number | { id: number } | null | undefined): string | null => {
  if (value == null) return null;
  return String(typeof value === "object" ? value.id : value);
};

/** Every page of a list, not just the first — the statistics must not quietly stop at a limit. */
async function getAllDocs<T>(path: string, where: string): Promise<T[]> {
  const docs: T[] = [];
  for (let page = 1; ; page++) {
    const result = await get<PayloadListResponse<T>>(`${path}?${where}&${buildQuery({ depth: 0, limit: 1000, page })}`);
    docs.push(...result.docs);
    if (page >= result.totalPages) return docs;
  }
}

/** Event ids a request at a time — thousands of them in one URL outgrow the server's header limit. */
const EVENT_ID_CHUNK = 100;

async function getAllForEventIds<T>(path: string, field: string, eventIds: string[]): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < eventIds.length; i += EVENT_ID_CHUNK) chunks.push(eventIds.slice(i, i + EVENT_ID_CHUNK));
  const results = await Promise.all(chunks.map((ids) => getAllDocs<T>(path, buildWhereParams({ [field]: { in: ids } }))));
  return results.flat();
}

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
  const docs = await getAllDocs<PayloadEventAdmin>("/events", where);
  return docs.map((e) => ({
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
  role?: RegistrationRow["role"] | null;
};

export async function getRegistrationsForEventIds(eventIds: string[]): Promise<RegistrationRow[]> {
  if (eventIds.length === 0) return [];
  const docs = await getAllForEventIds<PayloadRegistrationAdmin>("/registrations", "event", eventIds);
  return docs.map((r) => ({
    id: String(r.id),
    event_id: toId(r.event)!,
    user_id: toId(r.user)!,
    status: r.status,
    created_at: r.createdAt,
    attendance_status: (r.attendanceStatus ?? "not_marked") as RegistrationRow["attendance_status"],
    role: r.role ?? "participant",
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
  const docs = await getAllForEventIds<PayloadEventFeedbackAdmin>("/event-feedback", "registration.event", eventIds);
  return docs.map((f) => ({
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

type PayloadProfileAdmin = { id: number; fullName: string; createdAt: string; dateOfBirth?: string | null; over50?: boolean | null };

export async function getMunicipalityProfilesForAdmin(municipalityId: string): Promise<ProfileWithDob[]> {
  const where = buildWhereParams({ municipality: { equals: municipalityId } });
  const docs = await getAllDocs<PayloadProfileAdmin>("/profiles", where);
  return docs.map((p) => ({
    id: String(p.id),
    full_name: p.fullName,
    created_at: p.createdAt,
    date_of_birth: p.dateOfBirth ?? null,
    over_50: Boolean(p.over50),
  })) as ProfileWithDob[];
}

/** Cancels an event (soft-delete: sets deletedAt + status "cancelled") rather than hard-
 * deleting the row — works regardless of existing registrations, and triggers the
 * backend's notifyRegistrantsOnCancellation hook so pending/approved attendees are told.
 * Access-controlled to platform superadmins and the event's own municipality admin. */
export async function deleteEvent(eventId: string): Promise<void> {
  await patch(`/events/${eventId}`, { deletedAt: new Date().toISOString(), status: "cancelled" });
}

/** The event's creator takes the "Dobrovolnictví" flag off their event — nobody else may (Events
 * guardIsVolunteering). */
export async function removeVolunteeringFlag(eventId: string): Promise<void> {
  // Its own endpoint — works even when the obec co-organizing the event locks the creator out of editing.
  await post(`/events/${eventId}/volunteering`, { isVolunteering: false });
}

// --- Žádosti: role organizátora ---------------------------------

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

// --- Stížnosti na recenze ------------------------------------------------------------------

export type ReviewComplaintAdminRow = {
  id: string;
  review_type: "event-feedback" | "volunteer-rating";
  event_id: string | null;
  event_title: string;
  /** Null once the review itself is gone — the complaint can still be closed. */
  review: {
    rating: number;
    comment: string | null;
    author_name: string;
    /** Whom the review is about — the organization running the event, or the rated volunteer. */
    subject_name: string;
    created_at: string;
  } | null;
  complainant_name: string;
  reason: string;
  created_at: string;
};

export async function getReviewComplaintsForAdmin(municipalityId: string): Promise<ReviewComplaintAdminRow[]> {
  const result = await get<{ docs: ReviewComplaintAdminRow[] }>(`/municipalities/${municipalityId}/review-complaints`);
  return result.docs;
}

/** Upholding removes the review (and so drops it from every average); rejecting keeps it. */
export async function decideReviewComplaint(complaintId: string, uphold: boolean, note: string): Promise<void> {
  await post(`/review-complaints/${complaintId}/decide`, { uphold, note: note.trim() || undefined });
}

export type CoOrganizingRequestAdminRow = {
  id: string;
  event_id: string;
  event_title: string;
  /** The organization invited — the obec's own, or a business/club/person's. */
  organization_name: string;
  requested_by_name: string;
  municipality_id: string;
  created_at: string;
  /** Unanswered by then, the invitation lapses. */
  expires_at: string;
};

type PayloadCoOrganizingRequest = {
  id: number;
  event: number | { id: number } | null;
  eventTitle: string;
  organizationName: string;
  municipality: number | { id: number };
  requestedBy: number | { id: number };
  createdAt: string;
  expiresAt: string;
};

/** Names behind user ids, from their profiles (anyone without one is left out). */
async function fullNamesByUserIds(userIds: string[]): Promise<Map<string, string>> {
  const nameById = new Map<string, string>();
  if (userIds.length === 0) return nameById;
  const profileWhere = buildWhereParams({ user: { in: [...new Set(userIds)] } });
  const profiles = await get<PayloadListResponse<{ user: number | { id: number }; fullName: string }>>(
    `/profiles?${profileWhere}&depth=0&limit=500`,
  );
  for (const p of profiles.docs) {
    const uid = toId(p.user);
    if (uid) nameById.set(uid, p.fullName);
  }
  return nameById;
}

async function listPendingCoOrganizingRequests(
  filter: Parameters<typeof buildWhereParams>[0],
): Promise<CoOrganizingRequestAdminRow[]> {
  const query = buildQuery({ depth: 0, sort: "createdAt", limit: 1000 });
  const where = buildWhereParams({
    status: { equals: "pending" },
    expiresAt: { greater_than: new Date().toISOString() },
    ...filter,
  });
  const result = await get<PayloadListResponse<PayloadCoOrganizingRequest>>(`/co-organizing-requests?${where}&${query}`);

  const nameById = await fullNamesByUserIds(
    result.docs.map((r) => toId(r.requestedBy)).filter((v): v is string => Boolean(v)),
  );

  return result.docs.map((r) => ({
    id: String(r.id),
    event_id: toId(r.event) ?? "",
    event_title: r.eventTitle,
    organization_name: r.organizationName,
    requested_by_name: nameById.get(toId(r.requestedBy) ?? "") ?? "Organizátor",
    municipality_id: toId(r.municipality)!,
    created_at: r.createdAt,
    expires_at: r.expiresAt,
  }));
}

/** Pending invitations for the obec itself to co-organize an event — for one obec, or (a
 * superadmin, no `municipalityId`) every obec. The obec's own organization has no owner. */
export function getCoOrganizingRequestsForAdmin(municipalityId?: string): Promise<CoOrganizingRequestAdminRow[]> {
  return listPendingCoOrganizingRequests({
    organizationOwner: { exists: false },
    ...(municipalityId ? { municipality: { equals: municipalityId } } : {}),
  });
}

/** Pending invitations for one of the user's own organizations to co-organize an event. */
export function getMyCoOrganizingInvitations(userId: string): Promise<CoOrganizingRequestAdminRow[]> {
  return listPendingCoOrganizingRequests({ organizationOwner: { equals: userId } });
}

/** Approving puts the invited organization among the event's spolupořadatelé
 * (CoOrganizingRequests applyDecision). */
export async function decideCoOrganizingRequest(requestId: string, approve: boolean): Promise<void> {
  await patch(`/co-organizing-requests/${requestId}`, { status: approve ? "approved" : "rejected" });
}

export type EscalatedDeletionRequestRow = {
  id: string;
  event_id: string;
  event_title: string;
  requested_by_name: string;
  rejected_by_name: string;
  /** The requester is the event's pořadatel — removing them hands the event over. */
  requester_is_organizer: boolean;
  escalated_at: string;
  /** The event's start — the obec's deadline. */
  expires_at: string;
};

type PayloadEscalatedDeletionRequest = {
  id: number;
  event: number | { id: number; organizer: number | { id: number } } | null;
  eventTitle: string;
  requestedBy: number | { id: number };
  rejectedBy?: number | { id: number } | null;
  escalatedAt: string;
  expiresAt: string;
};

/** Requests to leave an event a spolupořadatel refused, escalated to the obec (EventDeletionRequests)
 * — for one obec, or (a superadmin, no `municipalityId`) every obec. */
export async function getEscalatedDeletionRequestsForAdmin(
  municipalityId?: string,
): Promise<EscalatedDeletionRequestRow[]> {
  const where = buildWhereParams({
    status: { equals: "escalated" },
    expiresAt: { greater_than: new Date().toISOString() },
    ...(municipalityId ? { municipality: { equals: municipalityId } } : {}),
  });
  const query = buildQuery({ depth: 1, sort: "escalatedAt", limit: 1000 });
  const result = await get<PayloadListResponse<PayloadEscalatedDeletionRequest>>(
    `/event-deletion-requests?${where}&${query}`,
  );
  const nameById = await fullNamesByUserIds(
    result.docs.flatMap((r) => [toId(r.requestedBy), toId(r.rejectedBy ?? null)]).filter((v): v is string => Boolean(v)),
  );
  return result.docs.map((r) => {
    const requesterId = toId(r.requestedBy) ?? "";
    const event = r.event && typeof r.event === "object" ? r.event : null;
    return {
      id: String(r.id),
      event_id: toId(r.event ?? null) ?? "",
      event_title: r.eventTitle,
      requested_by_name: nameById.get(requesterId) ?? "Organizátor",
      rejected_by_name: nameById.get(toId(r.rejectedBy ?? null) ?? "") ?? "spolupořadatel",
      requester_is_organizer: Boolean(event && toId(event.organizer) === requesterId),
      escalated_at: r.escalatedAt,
      expires_at: r.expiresAt,
    };
  });
}

/** `remove` takes the requester off the event without the others' consent; otherwise it stays. */
export async function decideEscalatedDeletionRequest(requestId: string, remove: boolean): Promise<void> {
  await post(`/events/deletion-requests/${requestId}/municipality-decide`, { remove });
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
