/**
 * Query functions shaped to match what the (originally Supabase-backed) page components
 * already expect — snake_case field names, same nesting — so pages mostly only need their
 * data-fetching `useEffect` rewritten, not their JSX.
 */
import { buildQuery, buildWhereParams, get, patch, post, uploadFile } from "./client";

import type { PayloadListResponse } from "./client";
import type { OrganizationType } from "@/lib/organizations";

// --- Municipalities ---------------------------------------------------------------------

export type RulesForCreation = "municipality_only" | "approved_organizers";

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

// --- Media (event cover image) -------------------------------------------------------------

/** Uploads the event cover image (brief §4 — crop to a fixed aspect ratio happens server-side
 * via Media.ts's `imageSizes`). Returns the media doc id to store on Events.image. */
export async function uploadEventImage(file: File, alt: string): Promise<{ id: string; url: string | null }> {
  const uploaded = await uploadFile<{ id: number; url?: string | null }>("media", file, { alt });
  return { id: String(uploaded.id), url: uploaded.url ?? null };
}

// --- Events ---------------------------------------------------------------------------

/** Who runs an event besides the obec — a café, a club, or one person ("Vycházky pro seniory"). */
export type OrganizationRef = { id: string; name: string; type: OrganizationType; owner_id: string };

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
  /** Framing of the photo in the 16:10 crop, as object-position percentages. */
  image_position: { x: number; y: number };
  category_ids: string[];
  organizer_id?: string;
  /** The organization the organizer runs it as — null when the obec's own admin founded it. */
  organization: OrganizationRef | null;
  co_organizer_ids: string[];
  co_organizations: OrganizationRef[];
  municipality_id?: string;
  status?: "active" | "full" | "finished" | "cancelled";
  is_hidden?: boolean;
  is_paid?: boolean;
  price_cents?: number | null;
  is_volunteering?: boolean;
  cancellation_policy: "none" | "cancel_24h" | "cancel_48h" | "cancel_7d";
  /** The viewer organizes an event the obec takes part in — may help with attendees, not edit/cancel. */
  locked_for_viewer: boolean;
  /** The viewer runs it with other organizers — deleting needs their consent (requestEventDeletion). */
  deletion_needs_consent: boolean;
};

type PayloadMedia = { id: number; url?: string | null };
type PayloadOrganization = { id: number; name: string; type: OrganizationType; owner: number | { id: number } };
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
  imagePositionX?: number | null;
  imagePositionY?: number | null;
  categories?: (number | { id: number })[] | null;
  organizer?: number | { id: number };
  organization?: number | PayloadOrganization | null;
  coOrganizers?: (number | { id: number })[] | null;
  coOrganizations?: (number | PayloadOrganization)[] | null;
  municipality?: number | { id: number };
  status?: EventRow["status"];
  isHidden?: boolean;
  isPaid?: boolean;
  priceCents?: number | null;
  isVolunteering?: boolean;
  cancellationPolicy?: EventRow["cancellation_policy"];
  lockedForViewer?: boolean | null;
  deletionNeedsConsent?: boolean | null;
};

const toId = (value: number | { id: number } | null | undefined): string | null => {
  if (value == null) return null;
  return String(typeof value === "object" ? value.id : value);
};

/** Only populated (depth ≥ 1) organizations — a bare id is one that's since been deleted. */
const mapOrganization = (o: number | PayloadOrganization | null | undefined): OrganizationRef | null =>
  o && typeof o === "object" ? { id: String(o.id), name: o.name, type: o.type, owner_id: toId(o.owner)! } : null;

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
  image_position: { x: e.imagePositionX ?? 50, y: e.imagePositionY ?? 50 },
  category_ids: (e.categories ?? []).map(toId).filter((v): v is string => Boolean(v)),
  organizer_id: toId(e.organizer) ?? undefined,
  organization: mapOrganization(e.organization),
  co_organizer_ids: (e.coOrganizers ?? []).map(toId).filter((v): v is string => Boolean(v)),
  co_organizations: (e.coOrganizations ?? []).map(mapOrganization).filter((o): o is OrganizationRef => Boolean(o)),
  municipality_id: toId(e.municipality) ?? undefined,
  status: e.status,
  is_hidden: e.isHidden,
  is_paid: e.isPaid,
  price_cents: e.priceCents ?? null,
  is_volunteering: e.isVolunteering,
  cancellation_policy: e.cancellationPolicy ?? "cancel_48h",
  locked_for_viewer: Boolean(e.lockedForViewer),
  deletion_needs_consent: Boolean(e.deletionNeedsConsent),
});

/** Upcoming (not cancelled) events for a municipality — or, with `null`, across every
 * municipality ("bez obce" users, the "Všechny obce" view) — ordered by date, category populated. */
export async function getUpcomingEvents(municipalityId: string | null): Promise<EventRow[]> {
  const where = buildWhereParams({
    ...(municipalityId ? { municipality: { equals: municipalityId } } : {}),
    status: { not_equals: "cancelled" },
    isHidden: { not_equals: true },
    dateTime: { greater_than: new Date().toISOString() },
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
  coOrganizationIds?: string[];
  categoryIds: string[];
  imageId?: string;
  /** Framing of the photo in the 16:10 crop (object-position percentages); centred when omitted. */
  imagePositionX?: number;
  imagePositionY?: number;
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
    coOrganizations: input.coOrganizationIds?.length ? input.coOrganizationIds.map(Number) : undefined,
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

export type RegistrationCountRow = { approved: number; pending: number };

/** Approved/pending counts per event from the public counts route — registrations themselves are
 * only readable by the organizer and the obec's admin, so counts can't be derived from them here. */
export async function getRegistrationCounts(eventIds: string[]): Promise<Map<string, RegistrationCountRow>> {
  const counts = new Map<string, RegistrationCountRow>();
  if (eventIds.length === 0) return counts;
  const params = new URLSearchParams();
  eventIds.forEach((id) => params.append("event", id));
  const result = await get<{ counts: Record<string, RegistrationCountRow> }>(`/events/registration-counts?${params}`);
  for (const [eventId, row] of Object.entries(result.counts)) counts.set(eventId, row);
  return counts;
}

/** Counts of pending+approved registrations, grouped by event_id — for capacity display. */
export async function getActiveRegistrationCountsByEvent(eventIds: string[]): Promise<Map<string, number>> {
  const counts = await getRegistrationCounts(eventIds);
  return new Map(Array.from(counts, ([eventId, row]) => [eventId, row.approved + row.pending]));
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
type PayloadRegistrationWithEvent = {
  id: number;
  status: RegistrationRow["status"];
  attendanceStatus?: AttendanceStatus;
  event: PayloadEventWithCategory | null;
};

export type RegistrationWithEventRow = {
  id: string;
  status: RegistrationRow["status"];
  attendance_status: AttendanceStatus;
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
    const attendance_status = r.attendanceStatus ?? "not_marked";
    if (!r.event || typeof r.event !== "object")
      return { id: String(r.id), status: r.status, attendance_status, events: null };
    const event = mapEvent(r.event);
    const categories: CategoryRow[] = (r.event.categories ?? [])
      .filter((c): c is PayloadCategoryPopulated => typeof c === "object" && "name" in c)
      .map((c) => ({ id: String(c.id), name: c.name, icon: c.icon ?? "", color: c.color ?? "" }));
    return { id: String(r.id), status: r.status, attendance_status, events: { ...event, categories } };
  });
}

// --- Event feedback -------------------------------------------------------------------

export type EventFeedbackRow = {
  id: string;
  registration_id: string;
  satisfaction_rating: number;
  felt_welcome_rating: number | null;
  met_someone_new: boolean;
  came_alone: boolean;
  comment: string | null;
};

type PayloadEventFeedback = {
  id: number;
  registration: number | { id: number };
  satisfactionRating: number;
  feltWelcomeRating?: number | null;
  metSomeoneNew?: boolean | null;
  cameAlone?: boolean | null;
  comment?: string | null;
};

const mapEventFeedback = (f: PayloadEventFeedback): EventFeedbackRow => ({
  id: String(f.id),
  registration_id: toId(f.registration)!,
  satisfaction_rating: f.satisfactionRating,
  felt_welcome_rating: f.feltWelcomeRating ?? null,
  met_someone_new: Boolean(f.metSomeoneNew),
  came_alone: Boolean(f.cameAlone),
  comment: f.comment ?? null,
});

/** Feedback already left for any of the given registrations, keyed by registration id — for
 * deciding which past attended events still need a feedback prompt. */
export async function getMyFeedbackForRegistrations(registrationIds: string[]): Promise<Map<string, EventFeedbackRow>> {
  const byRegistration = new Map<string, EventFeedbackRow>();
  if (registrationIds.length === 0) return byRegistration;
  const where = buildWhereParams({ registration: { in: registrationIds } });
  const result = await get<PayloadListResponse<PayloadEventFeedback>>(`/event-feedback?${where}&depth=0&limit=500`);
  for (const doc of result.docs) {
    const row = mapEventFeedback(doc);
    byRegistration.set(row.registration_id, row);
  }
  return byRegistration;
}

export async function submitEventFeedback(input: {
  registrationId: string;
  satisfactionRating: number;
  feltWelcomeRating?: number;
  metSomeoneNew?: boolean;
  cameAlone?: boolean;
  comment?: string;
}): Promise<EventFeedbackRow> {
  const doc = await post<PayloadEventFeedback>("/event-feedback", {
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
  user_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  volunteer_focus: string[] | null;
  volunteer_note: string | null;
  volunteer_since: string | null;
};

/** Goes through the scoped /admin/volunteers endpoint — the volunteer fields on a profile
 * can't be filtered on over plain REST (see Profiles `canReadVolunteerFields`). */
export async function getVolunteers(municipalityId: string): Promise<VolunteerRow[]> {
  const result = await get<{ docs: VolunteerRow[] }>(`/admin/volunteers?municipalityId=${encodeURIComponent(municipalityId)}`);
  return result.docs;
}

/** Admin adds someone (by user id) to their municipality's volunteer pool — Profiles.access.update
 * is self-only, so this goes through a dedicated overrideAccess endpoint. */
export async function addVolunteer(userId: string, municipalityId: string): Promise<void> {
  await post("/admin/volunteers", { userId: Number(userId), municipalityId: Number(municipalityId), isVolunteer: true });
}

/** Admin removes someone (by user id) from their municipality's volunteer pool. */
export async function removeVolunteer(userId: string, municipalityId: string): Promise<void> {
  await post("/admin/volunteers", { userId: Number(userId), municipalityId: Number(municipalityId), isVolunteer: false });
}

/** Display names for a list of user ids (e.g. co-organizers on an event detail page). */
export async function getFullNamesByUserIds(userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;
  const where = buildWhereParams({ user: { in: userIds } });
  const result = await get<PayloadListResponse<PayloadProfile>>(`/profiles?${where}&depth=0&limit=200`);
  for (const p of result.docs) {
    const uid = toId(p.user);
    if (uid) names.set(uid, p.fullName);
  }
  return names;
}

export type MunicipalityUserRow = { id: string; full_name: string; email: string | null };

/** For VolunteersTable — people with a profile in this municipality, matched by name, so an
 * admin can add someone to the volunteer pool without knowing their exact email. */
export async function searchMunicipalityUsers(municipalityId: string, query: string): Promise<MunicipalityUserRow[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const where = buildWhereParams({
    municipality: { equals: municipalityId },
    fullName: { like: trimmed },
  });
  const q = buildQuery({ sort: "fullName", depth: 1, limit: 10 });
  const result = await get<PayloadListResponse<PayloadProfile & { user: number | { id: number; email: string } }>>(
    `/profiles?${where}&${q}`,
  );
  return result.docs
    .filter((p) => typeof p.user === "object")
    .map((p) => ({
      id: String((p.user as { id: number }).id),
      full_name: p.fullName,
      email: (p.user as { email: string }).email ?? null,
    }));
}

/** For CoOrganizerPicker — the organizations of this obec's pořadatelé (never the obec itself,
 * never the searcher's own), matched by name. Only they can be an event's spolupořadatel. */
export async function searchCoOrganizerCandidates(municipalityId: string, query: string): Promise<OrganizationRef[]> {
  if (query.trim().length < 2) return [];
  const params = new URLSearchParams({ municipalityId, q: query.trim() });
  const result = await get<{ docs: OrganizationRef[] }>(`/events/co-organizer-candidates?${params}`);
  return result.docs;
}

/** Whether onboarding has to ask for the obec — only for a Google sign-up, which skips the
 * registration form's map, and only while the profile has none. */
export async function needsOnboardingMunicipality(): Promise<boolean> {
  const result = await get<{ needed: boolean }>("/auth/onboarding-municipality");
  return result.needed;
}

/** Files a Google sign-up under the obec picked in onboarding (profile + "participant" role). */
export async function setOnboardingMunicipality(municipalityId: string): Promise<void> {
  await post("/auth/onboarding-municipality", { municipality: municipalityId });
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

async function getMyRoleMunicipalityIds(userId: string, role: AppRole): Promise<string[]> {
  const where = buildWhereParams({ user: { equals: userId }, role: { equals: role } });
  const result = await get<PayloadListResponse<PayloadUserRole>>(`/user-roles?${where}&limit=100&depth=0`);
  return result.docs.map((r) => String(typeof r.municipality === "object" ? r.municipality.id : r.municipality));
}

/** Every municipality this user administers (all of their "municipality_admin" user-roles). */
export function getMyAdministeredMunicipalityIds(userId: string): Promise<string[]> {
  return getMyRoleMunicipalityIds(userId, "municipality_admin");
}

/** Every municipality where this user holds the "organizer" role. */
export function getMyOrganizerMunicipalityIds(userId: string): Promise<string[]> {
  return getMyRoleMunicipalityIds(userId, "organizer");
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

/** `reason` — the applicant's own words on why the obec should let them organize events there;
 * `organization` — who they'll organize as, created for them once the obec approves. */
export async function requestOrganizerRole(
  userId: string,
  municipalityId: string,
  reason: string,
  organization: { name: string; type: OrganizationType },
): Promise<void> {
  await post("/organizer-requests", {
    user: Number(userId),
    municipality: Number(municipalityId),
    reason,
    organizationName: organization.name,
    organizationType: organization.type,
  });
}

// --- Consented deletion of a co-organized event ---------------------------------------------

export type EventDeletionRequestRow = {
  id: string;
  requested_by_id: string;
  approver_ids: string[];
  approved_by_ids: string[];
  expires_at: string;
};

type PayloadEventDeletionRequest = {
  id: number;
  requestedBy: number | { id: number };
  approvers?: (number | { id: number })[] | null;
  approvedBy?: (number | { id: number })[] | null;
  expiresAt: string;
};

/** The open (pending, not yet lapsed) request to delete this event, if any. */
export async function getOpenEventDeletionRequest(eventId: string): Promise<EventDeletionRequestRow | null> {
  const where = buildWhereParams({
    event: { equals: eventId },
    status: { equals: "pending" },
    expiresAt: { greater_than: new Date().toISOString() },
  });
  const result = await get<PayloadListResponse<PayloadEventDeletionRequest>>(
    `/event-deletion-requests?${where}&depth=0&limit=1`,
  );
  const r = result.docs[0];
  if (!r) return null;
  const ids = (v: PayloadEventDeletionRequest["approvers"]) =>
    (v ?? []).map(toId).filter((x): x is string => Boolean(x));
  return {
    id: String(r.id),
    requested_by_id: toId(r.requestedBy)!,
    approver_ids: ids(r.approvers),
    approved_by_ids: ids(r.approvedBy),
    expires_at: r.expiresAt,
  };
}

/** Asks the event's other organizers to consent to deleting it — they get notified. */
export async function requestEventDeletion(eventId: string): Promise<void> {
  await post("/event-deletion-requests", { event: Number(eventId) });
}

/** "approved" = everyone consented and the event is gone; "pending" = others still have to. */
export async function decideEventDeletion(
  requestId: string,
  approve: boolean,
): Promise<{ status: "pending" | "approved" | "rejected" }> {
  return post(`/events/deletion-requests/${requestId}/decide`, { approve });
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
  link: string | null;
  read: boolean;
  created_at: string;
};

type PayloadNotification = {
  id: number;
  title: string;
  message: string;
  link?: string | null;
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
    link: n.link || null,
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
