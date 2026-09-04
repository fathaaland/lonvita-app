/**
 * Query functions shaped to match what the (originally Supabase-backed) page components
 * already expect — snake_case field names, same nesting — so pages mostly only need their
 * data-fetching `useEffect` rewritten, not their JSX.
 */
import { buildQuery, buildWhereParams, get, patch, post, uploadFile } from "./client";

import type { PayloadListResponse } from "./client";

// --- Municipalities ---------------------------------------------------------------------

export type RulesForCreation = "municipality_only" | "anyone" | "approved_organizers";

export type MunicipalityRow = {
  id: string;
  name: string;
  description: string | null;
  lat: number;
  lng: number;
  rules_for_creation: RulesForCreation;
};

type PayloadMunicipality = {
  id: number;
  name: string;
  description?: string | null;
  lat: number;
  lng: number;
  rulesForCreation?: RulesForCreation;
};

export async function getMunicipality(id: string): Promise<MunicipalityRow | null> {
  try {
    const doc = await get<PayloadMunicipality>(`/municipalities/${id}`);
    return {
      id: String(doc.id),
      name: doc.name,
      description: doc.description ?? null,
      lat: doc.lat,
      lng: doc.lng,
      rules_for_creation: doc.rulesForCreation ?? "approved_organizers",
    };
  } catch {
    return null;
  }
}

export async function setMunicipalityRulesForCreation(municipalityId: string, rules: RulesForCreation): Promise<void> {
  await patch(`/municipalities/${municipalityId}`, { rulesForCreation: rules });
}

export async function listMunicipalities(): Promise<Pick<MunicipalityRow, "id" | "name" | "lat" | "lng">[]> {
  const query = buildQuery({ sort: "name", limit: 200 });
  const result = await get<PayloadListResponse<PayloadMunicipality>>(`/municipalities?${query}`);
  return result.docs.map((m) => ({ id: String(m.id), name: m.name, lat: m.lat, lng: m.lng }));
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

// --- Organizations ------------------------------------------------------------------------

export type OrganizationRow = { id: string; name: string };

type PayloadOrganization = { id: number; name: string };

/** The organizations this organizer manages (brief §4 "Organizace" — free text, no obec approval). */
export async function getMyOrganizations(userId: string): Promise<OrganizationRow[]> {
  const where = buildWhereParams({ owner: { equals: userId } });
  const query = buildQuery({ sort: "name", limit: 200 });
  const result = await get<PayloadListResponse<PayloadOrganization>>(`/organizations?${where}&${query}`);
  return result.docs.map((o) => ({ id: String(o.id), name: o.name }));
}

export async function createOrganization(name: string, ownerId: string): Promise<OrganizationRow> {
  const doc = await post<PayloadOrganization>("/organizations", { name, owner: Number(ownerId) });
  return { id: String(doc.id), name: doc.name };
}

// --- Media (event cover image) -------------------------------------------------------------

/** Uploads the event cover image (brief §4 — crop to a fixed aspect ratio happens server-side
 * via Media.ts's `imageSizes`). Returns the media doc id to store on Events.image. */
export async function uploadEventImage(file: File, alt: string): Promise<{ id: string; url: string | null }> {
  const uploaded = await uploadFile<{ id: number; url?: string | null }>("media", file, { alt });
  return { id: String(uploaded.id), url: uploaded.url ?? null };
}

// --- Events ---------------------------------------------------------------------------

export type EventRow = {
  id: string;
  title: string;
  description?: string;
  date_time: string;
  end_date_time: string | null;
  recurrence_rule: string | null;
  location_text: string;
  lat: number | null;
  lng: number | null;
  accessibility_tags: string[];
  capacity: number;
  registration_approval_mode: "auto" | "manual";
  image_url: string | null;
  category_ids: string[];
  organizer_id?: string;
  organization_id: string | null;
  co_organizer_ids: string[];
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
  endDateTime?: string | null;
  recurrenceRule?: string | null;
  locationText: string;
  lat?: number | null;
  lng?: number | null;
  accessibilityTags?: string[] | null;
  capacity: number;
  registrationApprovalMode?: "auto" | "manual";
  image?: number | PayloadMedia | null;
  categories?: (number | { id: number })[] | null;
  organizer?: number | { id: number };
  organization?: number | { id: number } | null;
  coOrganizers?: (number | { id: number })[] | null;
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
  end_date_time: e.endDateTime ?? null,
  recurrence_rule: e.recurrenceRule ?? null,
  location_text: e.locationText,
  lat: e.lat ?? null,
  lng: e.lng ?? null,
  accessibility_tags: e.accessibilityTags ?? [],
  capacity: e.capacity,
  registration_approval_mode: e.registrationApprovalMode ?? "manual",
  image_url: typeof e.image === "object" && e.image ? (e.image.url ?? null) : null,
  category_ids: (e.categories ?? []).map(toId).filter((v): v is string => Boolean(v)),
  organizer_id: toId(e.organizer) ?? undefined,
  organization_id: toId(e.organization),
  co_organizer_ids: (e.coOrganizers ?? []).map(toId).filter((v): v is string => Boolean(v)),
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

/** Events this user organizes (any status/date) — "Moje akce" needs these alongside their
 * registrations, since creating an event doesn't register the organizer as an attendee. */
/** Events this user organizes OR co-organizes (brief §4 "Spolupořadatelství" — the event
 * appears in every co-organizer's own dashboard, not just the primary organizer's). */
export async function getMyOrganizedEvents(userId: string): Promise<EventRow[]> {
  const where = `where[or][0][organizer][equals]=${userId}&where[or][1][coOrganizers][contains]=${userId}`;
  const query = buildQuery({ sort: "-dateTime", depth: 1, limit: 200 });
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
  endDateTimeIso?: string;
  recurrenceRule?: string;
  locationText: string;
  lat: number;
  lng: number;
  accessibilityTags?: string[];
  capacity: number;
  registrationApprovalMode?: "auto" | "manual";
  organizerUserId: string;
  municipalityId: string;
  organizationId?: string;
  categoryIds: string[];
  imageId?: string;
  isVolunteering?: boolean;
  isPaid?: boolean;
  priceCents?: number;
};

export async function createEvent(input: CreateEventInput): Promise<EventRow> {
  const doc = await post<PayloadEvent>("/events", {
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
    categories: input.categoryIds.map(Number),
    image: input.imageId ? Number(input.imageId) : undefined,
    status: "active",
    isPaid: input.isPaid ?? false,
    priceCents: input.isPaid ? input.priceCents : undefined,
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
  status: "pending" | "approved" | "rejected" | "cancelled";
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
    event: Number(eventId),
    user: Number(userId),
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

type PayloadCategoryPopulated = { id: number; name: string; icon?: string | null; color?: string | null };
type PayloadEventWithCategory = PayloadEvent & { categories?: (number | PayloadCategoryPopulated)[] | null };
type PayloadRegistrationWithEvent = { id: number; status: RegistrationRow["status"]; event: PayloadEventWithCategory | null };

export type RegistrationWithEventRow = {
  status: RegistrationRow["status"];
  events: (EventRow & { categories: CategoryRow[] }) | null;
};

/** For MyEvents.tsx — this user's registrations, with the event (and its categories) populated. */
export async function getMyRegistrationsWithEvents(userId: string): Promise<RegistrationWithEventRow[]> {
  const where = buildWhereParams({ user: { equals: userId } });
  const query = buildQuery({ depth: 2, limit: 200 });
  const result = await get<PayloadListResponse<PayloadRegistrationWithEvent>>(
    `/registrations?${where}&${query}`,
  );

  return result.docs.map((r) => {
    if (!r.event || typeof r.event !== "object") return { status: r.status, events: null };
    const event = mapEvent(r.event);
    const categories: CategoryRow[] = (r.event.categories ?? [])
      .filter((c): c is PayloadCategoryPopulated => typeof c === "object" && "name" in c)
      .map((c) => ({ id: String(c.id), name: c.name, icon: c.icon ?? "", color: c.color ?? "" }));
    return { status: r.status, events: { ...event, categories } };
  });
}

/** For EventDetail.tsx — pending+approved registrations for one event, with each participant's name. */
export async function getEventRegistrationsWithNames(
  eventId: string,
): Promise<{ id: string; user_id: string; status: string; full_name: string }[]> {
  const where = buildWhereParams({
    event: { equals: eventId },
    status: { in: ["pending", "approved"] },
  });
  const result = await get<PayloadListResponse<PayloadRegistration>>(
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
    attendanceMarkedBy: Number(markedByUserId),
  });
}

// --- Profiles -----------------------------------------------------------------------

export type ProfileRow = {
  id: string;
  full_name: string;
  phone: string | null;
  phone_verified: boolean;
  notify_email: boolean;
  notify_in_app: boolean;
  municipality_id: string | null;
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
  phoneVerified?: boolean;
  notifyEmail?: boolean;
  notifyInApp?: boolean;
  municipality?: number | { id: number } | null;
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
  phone_verified: Boolean(p.phoneVerified),
  notify_email: p.notifyEmail ?? true,
  notify_in_app: p.notifyInApp ?? true,
  municipality_id: toId(p.municipality),
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

export type AppRole = "municipality_admin" | "organizer" | "participant" | "prescriber";

type PayloadUserRole = { id: number; role: AppRole; municipality: number | { id: number } };

export async function getMyRoles(userId: string): Promise<AppRole[]> {
  const where = buildWhereParams({ user: { equals: userId } });
  const result = await get<PayloadListResponse<PayloadUserRole>>(`/user-roles?${where}&limit=100&depth=0`);
  return result.docs.map((r) => r.role);
}

/** The municipality this user administers (their "municipality_admin" user-role), if any.
 * Distinct from their home municipality (profile.municipality_id) — a superadmin can grant
 * municipality_admin for an obec the person doesn't personally live in. */
export async function getMyAdministeredMunicipalityId(userId: string): Promise<string | null> {
  const where = buildWhereParams({ user: { equals: userId }, role: { equals: "municipality_admin" } });
  const result = await get<PayloadListResponse<PayloadUserRole>>(`/user-roles?${where}&limit=1&depth=0`);
  const row = result.docs[0];
  if (!row) return null;
  return String(typeof row.municipality === "object" ? row.municipality.id : row.municipality);
}

// --- Organizer / volunteering-flag requests ----------------------------------------------

export type RequestStatus = "pending" | "approved" | "rejected";

type PayloadOrganizerRequest = { id: number; status: RequestStatus; municipality: number | { id: number } };

/** The organizer-role request(s) this user has made — for showing pending/approved/rejected
 * status on their profile (brief §3 "Upozornění jde uživateli v obou případech"). */
export async function getMyOrganizerRequests(userId: string): Promise<{ id: string; status: RequestStatus; municipality_id: string }[]> {
  const where = buildWhereParams({ user: { equals: userId } });
  const query = buildQuery({ sort: "-createdAt", depth: 0, limit: 50 });
  const result = await get<PayloadListResponse<PayloadOrganizerRequest>>(`/organizer-requests?${where}&${query}`);
  return result.docs.map((r) => ({
    id: String(r.id),
    status: r.status,
    municipality_id: toId(r.municipality)!,
  }));
}

export async function requestOrganizerRole(userId: string, municipalityId: string): Promise<void> {
  await post("/organizer-requests", { user: Number(userId), municipality: Number(municipalityId) });
}

export async function requestVolunteerFlag(eventId: string, userId: string): Promise<void> {
  await post("/volunteer-flag-requests", { event: Number(eventId), requestedBy: Number(userId) });
}

// --- Consents / notification preferences ------------------------------------------------

const CONSENT_VERSION = "1.0";

type PayloadConsent = { id: number; type: string; revokedAt?: string | null };

/** Whether the user currently has an active (non-revoked) marketing consent. */
export async function getMarketingConsent(userId: string): Promise<boolean> {
  const where = buildWhereParams({ user: { equals: userId }, type: { equals: "marketing" } });
  const query = buildQuery({ sort: "-createdAt", limit: 1, depth: 0 });
  const result = await get<PayloadListResponse<PayloadConsent>>(`/consents?${where}&${query}`);
  const latest = result.docs[0];
  return Boolean(latest && !latest.revokedAt);
}

/** Grants a fresh marketing consent, or revokes the current active one. */
export async function setMarketingConsent(userId: string, enabled: boolean): Promise<void> {
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
  const result = await get<PayloadListResponse<PayloadConsent>>(`/consents?${where}&${query}`);
  const active = result.docs.find((c) => !c.revokedAt);
  if (active) {
    await patch(`/consents/${active.id}`, { revokedAt: new Date().toISOString() });
  }
}

// --- Notifications --------------------------------------------------------------------

export type NotificationRow = {
  id: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
};

type PayloadNotification = {
  id: number;
  title: string;
  message: string;
  readAt?: string | null;
  createdAt: string;
};

export async function getMyNotifications(userId: string): Promise<NotificationRow[]> {
  const where = buildWhereParams({ user: { equals: userId } });
  const query = buildQuery({ sort: "-createdAt", depth: 0, limit: 100 });
  const result = await get<PayloadListResponse<PayloadNotification>>(`/notifications?${where}&${query}`);
  return result.docs.map((n) => ({
    id: String(n.id),
    title: n.title,
    message: n.message,
    read: Boolean(n.readAt),
    created_at: n.createdAt,
  }));
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const where = buildWhereParams({ user: { equals: userId }, readAt: { exists: false } });
  const result = await get<PayloadListResponse<{ id: number }>>(`/notifications?${where}&depth=0&limit=0`);
  return result.totalDocs;
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await patch(`/notifications/${notificationId}`, { readAt: new Date().toISOString() });
}
