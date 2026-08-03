/**
 * Query functions shaped to match what the (originally Supabase-backed) page components
 * already expect — snake_case field names, same nesting — so pages mostly only need their
 * data-fetching `useEffect` rewritten, not their JSX.
 */
import { buildQuery, buildWhereParams, get, patch, post } from "./client";

import type { PayloadListResponse } from "./client";

// --- Municipalities ---------------------------------------------------------------------

export type MunicipalityRow = {
  id: string;
  name: string;
  description: string | null;
  rules_for_creation: "anyone" | "approved_organizers" | "municipality_only";
};

type PayloadMunicipality = {
  id: number;
  name: string;
  description?: string | null;
  rulesForCreation: MunicipalityRow["rules_for_creation"];
};

export async function getMunicipality(id: string): Promise<MunicipalityRow | null> {
  try {
    const doc = await get<PayloadMunicipality>(`/municipalities/${id}`);
    return {
      id: String(doc.id),
      name: doc.name,
      description: doc.description ?? null,
      rules_for_creation: doc.rulesForCreation,
    };
  } catch {
    return null;
  }
}

export async function listMunicipalities(): Promise<Pick<MunicipalityRow, "id" | "name">[]> {
  const query = buildQuery({ sort: "name", limit: 200 });
  const result = await get<PayloadListResponse<PayloadMunicipality>>(`/municipalities?${query}`);
  return result.docs.map((m) => ({ id: String(m.id), name: m.name }));
}

// --- Municipality areas (onboarding neighborhoods) --------------------------------------

export type MunicipalityAreaRow = {
  id: string;
  name: string;
  code: string;
  center_lat: number;
  center_lng: number;
};

type PayloadMunicipalityArea = {
  id: number;
  name: string;
  code: string;
  centerLat: number;
  centerLng: number;
};

export async function getMunicipalityAreas(municipalityId: string): Promise<MunicipalityAreaRow[]> {
  const where = buildWhereParams({ municipality: { equals: municipalityId } });
  const query = buildQuery({ sort: "name", limit: 200 });
  const result = await get<PayloadListResponse<PayloadMunicipalityArea>>(
    `/municipality-areas?${where}&${query}`,
  );
  return result.docs.map((a) => ({
    id: String(a.id),
    name: a.name,
    code: a.code,
    center_lat: a.centerLat,
    center_lng: a.centerLng,
  }));
}

// --- Event categories --------------------------------------------------------------------

export type CategoryRow = { id: string; name: string; icon: string; color: string };

type PayloadCategory = { id: number; name: string; icon?: string | null; color?: string | null };

export async function getEventCategories(): Promise<CategoryRow[]> {
  const query = buildQuery({ sort: "name", limit: 200 });
  const result = await get<PayloadListResponse<PayloadCategory>>(`/event-categories?${query}`);
  return result.docs.map((c) => ({
    id: String(c.id),
    name: c.name,
    icon: c.icon ?? "",
    color: c.color ?? "",
  }));
}

// --- Events ---------------------------------------------------------------------------

export type EventRow = {
  id: string;
  title: string;
  description?: string;
  date_time: string;
  location_text: string;
  lat: number | null;
  lng: number | null;
  capacity: number;
  image_url: string | null;
  category_id: string | null;
  organizer_id?: string;
  municipality_id?: string;
  status?: "active" | "full" | "finished" | "cancelled";
  is_paid?: boolean;
  price_cents?: number | null;
  is_volunteering?: boolean;
  cancellation_policy: "none" | "cancel_24h" | "cancel_48h" | "cancel_7d";
};

type PayloadMedia = { id: number; url?: string | null };
type PayloadEvent = {
  id: number;
  title: string;
  description?: string | null;
  dateTime: string;
  locationText: string;
  lat?: number | null;
  lng?: number | null;
  capacity: number;
  image?: number | PayloadMedia | null;
  category?: number | { id: number } | null;
  organizer?: number | { id: number };
  municipality?: number | { id: number };
  status?: EventRow["status"];
  isPaid?: boolean;
  priceCents?: number | null;
  isVolunteering?: boolean;
  cancellationPolicy?: EventRow["cancellation_policy"];
};

const toId = (value: number | { id: number } | null | undefined): string | null => {
  if (value == null) return null;
  return String(typeof value === "object" ? value.id : value);
};

const mapEvent = (e: PayloadEvent): EventRow => ({
  id: String(e.id),
  title: e.title,
  description: e.description ?? undefined,
  date_time: e.dateTime,
  location_text: e.locationText,
  lat: e.lat ?? null,
  lng: e.lng ?? null,
  capacity: e.capacity,
  image_url: typeof e.image === "object" && e.image ? (e.image.url ?? null) : null,
  category_id: toId(e.category),
  organizer_id: toId(e.organizer) ?? undefined,
  municipality_id: toId(e.municipality) ?? undefined,
  status: e.status,
  is_paid: e.isPaid,
  price_cents: e.priceCents ?? null,
  is_volunteering: e.isVolunteering,
  cancellation_policy: e.cancellationPolicy ?? "cancel_48h",
});

/** Upcoming (not cancelled) events for a municipality, ordered by date, category populated. */
export async function getUpcomingEvents(municipalityId: string): Promise<EventRow[]> {
  const where = buildWhereParams({
    municipality: { equals: municipalityId },
    status: { not_equals: "cancelled" },
  });
  const query = buildQuery({ sort: "dateTime", depth: 1, limit: 200 });
  const result = await get<PayloadListResponse<PayloadEvent>>(`/events?${where}&${query}`);
  return result.docs.map(mapEvent);
}

export async function getEvent(id: string): Promise<EventRow | null> {
  try {
    const doc = await get<PayloadEvent>(`/events/${id}?depth=1`);
    return mapEvent(doc);
  } catch {
    return null;
  }
}

type CreateEventInput = {
  title: string;
  description: string;
  dateTimeIso: string;
  locationText: string;
  capacity: number;
  organizerUserId: string;
  municipalityId: string;
  categoryId: string;
  isVolunteering?: boolean;
};

/** Paid events aren't supported yet (Stripe integration deferred) — always created free. */
export async function createEvent(input: CreateEventInput): Promise<EventRow> {
  const doc = await post<PayloadEvent>("/events", {
    title: input.title,
    description: input.description,
    dateTime: input.dateTimeIso,
    locationText: input.locationText,
    capacity: input.capacity,
    organizer: input.organizerUserId,
    municipality: input.municipalityId,
    category: input.categoryId,
    status: "active",
    isPaid: false,
    isVolunteering: input.isVolunteering ?? false,
    cancellationPolicy: "cancel_48h",
  });
  return mapEvent(doc);
}

export async function updateEvent(eventId: string, data: Record<string, unknown>): Promise<EventRow> {
  const doc = await patch<PayloadEvent>(`/events/${eventId}`, data);
  return mapEvent(doc);
}

// --- Registrations ----------------------------------------------------------------------

export type RegistrationRow = {
  id: string;
  event_id: string;
  user_id: string;
  status: "pending_payment" | "pending" | "approved" | "rejected" | "cancelled";
};

export type AttendanceStatus = "not_marked" | "attended" | "no_show" | "excused";

type PayloadRegistration = {
  id: number;
  event: number | { id: number };
  user: number | { id: number };
  status: RegistrationRow["status"];
  attendanceStatus?: AttendanceStatus;
};

const mapRegistration = (r: PayloadRegistration): RegistrationRow => ({
  id: String(r.id),
  event_id: toId(r.event)!,
  user_id: toId(r.user)!,
  status: r.status,
});

/** Counts of pending+approved registrations, grouped by event_id — for capacity display. */
export async function getActiveRegistrationCountsByEvent(): Promise<Map<string, number>> {
  const where = buildWhereParams({ status: { in: ["pending", "approved"] } });
  const query = buildQuery({ limit: 1000, depth: 0 });
  const result = await get<PayloadListResponse<PayloadRegistration>>(`/registrations?${where}&${query}`);

  const counts = new Map<string, number>();
  for (const doc of result.docs) {
    const eventId = toId(doc.event);
    if (!eventId) continue;
    counts.set(eventId, (counts.get(eventId) ?? 0) + 1);
  }
  return counts;
}

export async function getUserRegistrations(userId: string): Promise<RegistrationRow[]> {
  const where = buildWhereParams({ user: { equals: userId } });
  const result = await get<PayloadListResponse<PayloadRegistration>>(`/registrations?${where}&depth=1&limit=200`);
  return result.docs.map(mapRegistration);
}

export async function createRegistration(eventId: string, userId: string): Promise<RegistrationRow> {
  const doc = await post<PayloadRegistration>("/registrations", {
    event: eventId,
    user: userId,
    status: "pending",
  });
  return mapRegistration(doc);
}

export async function cancelRegistration(registrationId: string): Promise<void> {
  await patch(`/registrations/${registrationId}`, { status: "cancelled" });
}

export async function updateRegistrationStatus(
  registrationId: string,
  status: RegistrationRow["status"],
): Promise<void> {
  await patch(`/registrations/${registrationId}`, { status });
}

type PayloadEventWithCategory = PayloadEvent & { category?: number | { id: number; name: string; icon?: string | null; color?: string | null } | null };
type PayloadRegistrationWithEvent = { id: number; status: RegistrationRow["status"]; event: PayloadEventWithCategory | null };

export type RegistrationWithEventRow = {
  status: RegistrationRow["status"];
  events: (EventRow & { category: CategoryRow | null }) | null;
};

/** For MyEvents.tsx — this user's registrations, with the event (and its category) populated. */
export async function getMyRegistrationsWithEvents(userId: string): Promise<RegistrationWithEventRow[]> {
  const where = buildWhereParams({ user: { equals: userId } });
  const query = buildQuery({ depth: 2, limit: 200 });
  const result = await get<PayloadListResponse<PayloadRegistrationWithEvent>>(
    `/registrations?${where}&${query}`,
  );

  return result.docs.map((r) => {
    if (!r.event || typeof r.event !== "object") return { status: r.status, events: null };
    const event = mapEvent(r.event);
    const cat = r.event.category;
    const category: CategoryRow | null =
      cat && typeof cat === "object" && "name" in cat
        ? { id: String(cat.id), name: cat.name, icon: cat.icon ?? "", color: cat.color ?? "" }
        : null;
    return { status: r.status, events: { ...event, category } };
  });
}

/** For EventDetail.tsx — pending+approved registrations for one event, with each participant's name. */
export async function getEventRegistrationsWithNames(
  eventId: string,
): Promise<{ id: string; user_id: string; status: string; payment_status: string; full_name: string }[]> {
  const where = buildWhereParams({
    event: { equals: eventId },
    status: { in: ["pending", "approved"] },
  });
  const result = await get<PayloadListResponse<PayloadRegistration & { paymentStatus?: string }>>(
    `/registrations?${where}&depth=0&limit=500`,
  );

  const userIds = Array.from(new Set(result.docs.map((r) => toId(r.user)).filter((v): v is string => Boolean(v))));
  const nameById = new Map<string, string>();
  if (userIds.length) {
    const profileWhere = buildWhereParams({ user: { in: userIds } });
    const profiles = await get<PayloadListResponse<PayloadProfile>>(
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
    status: r.status,
    payment_status: r.paymentStatus ?? "none",
    full_name: nameById.get(toId(r.user) ?? "") ?? "Účastník",
  }));
}

export async function getOrganizerName(userId: string): Promise<string | null> {
  const where = buildWhereParams({ user: { equals: userId } });
  const result = await get<PayloadListResponse<PayloadProfile>>(`/profiles?${where}&limit=1&depth=0`);
  return result.docs[0]?.fullName ?? null;
}

export type ManageRegistrationRow = {
  id: string;
  status: RegistrationRow["status"];
  attendance_status: AttendanceStatus;
  user_id: string;
  full_name: string;
  phone: string | null;
};

/** For ManageEvent.tsx — every registration for one event (any status), with name+phone. */
export async function getEventRegistrationsForManage(eventId: string): Promise<ManageRegistrationRow[]> {
  const where = buildWhereParams({ event: { equals: eventId } });
  const result = await get<PayloadListResponse<PayloadRegistration>>(
    `/registrations?${where}&depth=0&limit=500&sort=createdAt`,
  );

  const userIds = Array.from(new Set(result.docs.map((r) => toId(r.user)).filter((v): v is string => Boolean(v))));
  const infoById = new Map<string, { fullName: string; phone: string | null }>();
  if (userIds.length) {
    const profileWhere = buildWhereParams({ user: { in: userIds } });
    const profiles = await get<PayloadListResponse<PayloadProfile>>(
      `/profiles?${profileWhere}&depth=0&limit=500`,
    );
    for (const p of profiles.docs) {
      const uid = toId(p.user);
      if (uid) infoById.set(uid, { fullName: p.fullName, phone: p.phone ?? null });
    }
  }

  return result.docs.map((r) => {
    const uid = toId(r.user)!;
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
export async function updateAttendance(
  registrationId: string,
  attendanceStatus: AttendanceStatus,
  markedByUserId: string,
): Promise<void> {
  await patch(`/registrations/${registrationId}`, {
    attendanceStatus,
    attendanceMarkedAt: new Date().toISOString(),
    attendanceMarkedBy: markedByUserId,
  });
}

// --- Profiles -----------------------------------------------------------------------

export type ProfileRow = {
  id: string;
  full_name: string;
  phone: string | null;
  municipality_id: string | null;
  payout_iban: string | null;
  onboarding_completed: boolean;
  date_of_birth: string | null;
  home_area_id: string | null;
  gender: string | null;
  interests: string[] | null;
  is_volunteer: boolean;
  volunteer_focus: string[] | null;
  volunteer_note: string | null;
  volunteer_since: string | null;
};

type PayloadProfile = {
  id: number;
  user: number | { id: number };
  fullName: string;
  phone?: string | null;
  municipality?: number | { id: number } | null;
  payoutIban?: string | null;
  onboardingCompleted?: boolean;
  dateOfBirth?: string | null;
  homeArea?: number | { id: number } | null;
  gender?: string | null;
  interests?: (number | { id: number })[] | null;
  isVolunteer?: boolean;
  volunteerFocus?: string[] | null;
  volunteerNote?: string | null;
  volunteerSince?: string | null;
};

const mapProfile = (p: PayloadProfile): ProfileRow => ({
  id: String(p.id),
  full_name: p.fullName,
  phone: p.phone ?? null,
  municipality_id: toId(p.municipality),
  payout_iban: p.payoutIban ?? null,
  onboarding_completed: Boolean(p.onboardingCompleted),
  date_of_birth: p.dateOfBirth ?? null,
  home_area_id: toId(p.homeArea),
  gender: p.gender ?? null,
  interests: p.interests?.map((i) => toId(i)!).filter(Boolean) ?? null,
  is_volunteer: Boolean(p.isVolunteer),
  volunteer_focus: p.volunteerFocus ?? null,
  volunteer_note: p.volunteerNote ?? null,
  volunteer_since: p.volunteerSince ?? null,
});

export type VolunteerRow = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  volunteer_focus: string[] | null;
  volunteer_note: string | null;
  volunteer_since: string | null;
};

export async function getVolunteers(municipalityId: string): Promise<VolunteerRow[]> {
  const where = buildWhereParams({
    municipality: { equals: municipalityId },
    isVolunteer: { equals: true },
  });
  const query = buildQuery({ sort: "-volunteerSince", depth: 1, limit: 500 });
  const result = await get<PayloadListResponse<PayloadProfile & { user: number | { id: number; email: string } }>>(
    `/profiles?${where}&${query}`,
  );
  return result.docs.map((p) => ({
    id: String(p.id),
    full_name: p.fullName,
    phone: p.phone ?? null,
    email: typeof p.user === "object" ? p.user.email : null,
    volunteer_focus: p.volunteerFocus ?? null,
    volunteer_note: p.volunteerNote ?? null,
    volunteer_since: p.volunteerSince ?? null,
  }));
}

export async function createOrganizerRequest(
  userId: string,
  municipalityId: string,
  description: string,
): Promise<void> {
  await post("/organizer-requests", {
    user: userId,
    municipality: municipalityId,
    description,
    status: "pending",
  });
}

export async function hasPendingOrganizerRequest(userId: string): Promise<boolean> {
  const where = buildWhereParams({ user: { equals: userId }, status: { equals: "pending" } });
  const result = await get<PayloadListResponse<{ id: number }>>(
    `/organizer-requests?${where}&limit=1&depth=0`,
  );
  return result.docs.length > 0;
}

export async function getMyProfile(userId: string): Promise<ProfileRow | null> {
  const where = buildWhereParams({ user: { equals: userId } });
  const result = await get<PayloadListResponse<PayloadProfile>>(`/profiles?${where}&limit=1&depth=0`);
  return result.docs[0] ? mapProfile(result.docs[0]) : null;
}

export async function updateProfile(profileId: string, data: Record<string, unknown>): Promise<ProfileRow> {
  const doc = await patch<PayloadProfile>(`/profiles/${profileId}`, data);
  return mapProfile(doc);
}

// --- User roles -----------------------------------------------------------------------

export type AppRole = "admin" | "organizer" | "participant";

type PayloadUserRole = { id: number; role: AppRole; municipality: number | { id: number } };

export async function getMyRoles(userId: string): Promise<AppRole[]> {
  const where = buildWhereParams({ user: { equals: userId } });
  const result = await get<PayloadListResponse<PayloadUserRole>>(`/user-roles?${where}&limit=100&depth=0`);
  return result.docs.map((r) => r.role);
}
