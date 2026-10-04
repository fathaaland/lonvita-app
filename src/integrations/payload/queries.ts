/**
 * Query functions shaped to match what the (originally Supabase-backed) page components
 * already expect — snake_case field names, same nesting — so pages mostly only need their
 * data-fetching `useEffect` rewritten, not their JSX.
 */
import { buildQuery, buildWhereParams, del, get, patch, post, uploadFile, PayloadApiError } from "./client";

import type { PayloadListResponse } from "./client";
import type { AnyOrganizationType, OrganizationType } from "@/lib/organizations";
import { MUNICIPALITY_ORGANIZATION_TYPE } from "@/lib/organizations";
import type { OrganizationFeedbackSummary } from "@/lib/organization-stats";

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
/** `owner_id` is null for the obec's own organization (type "municipality"). */
export type OrganizationRef = {
  id: string;
  name: string;
  type: AnyOrganizationType;
  owner_id: string | null;
  /** The organization's own photo or logo — set on its "Organizace" page. */
  avatar_url?: string | null;
};

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
  /** The organization the organizer runs it as — the obec's own one when its admin founded it. */
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

type PayloadMedia = { id: number; url?: string | null; sizes?: { avatar?: { url?: string | null } } };
type PayloadOrganization = {
  id: number;
  name: string;
  type: AnyOrganizationType;
  owner?: number | { id: number } | null;
  avatarUrl?: string | null;
  description?: string | null;
};
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
  o && typeof o === "object"
    ? { id: String(o.id), name: o.name, type: o.type, owner_id: toId(o.owner), avatar_url: o.avatarUrl ?? null }
    : null;

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
/** Events the user runs or co-organizes — and, for an obec's admin, every event the obec runs or
 * co-organizes: once the obec agrees to co-organize, the event is the obec's as much as the pořadatel's. */
export async function getMyOrganizedEvents(userId: string, administeredMunicipalityIds: string[] = []): Promise<EventRow[]> {
  const params = new URLSearchParams({ "where[or][0][organizer][equals]": userId, "where[or][1][coOrganizers][contains]": userId });
  if (administeredMunicipalityIds.length > 0) {
    const obecWhere = buildWhereParams({
      type: { equals: MUNICIPALITY_ORGANIZATION_TYPE },
      municipality: { in: administeredMunicipalityIds },
    });
    const obecOrganizations = await get<PayloadListResponse<{ id: number }>>(`/organizations?${obecWhere}&depth=0&limit=100`);
    for (const o of obecOrganizations.docs) {
      params.append("where[or][2][organization][in][]", String(o.id));
      params.append("where[or][3][coOrganizations][in][]", String(o.id));
    }
  }
  const where = params.toString();
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

export type RegistrationRole = "participant" | "volunteer";

export type RegistrationRow = {
  id: string;
  event_id: string;
  user_id: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  /** A volunteer helps run the event (an accepted invitation from the pool) — not a participant. */
  role: RegistrationRole;
};

export type AttendanceStatus = "not_marked" | "attended" | "no_show" | "excused";

type PayloadRegistration = {
  id: number;
  event: number | { id: number };
  user: number | { id: number };
  status: RegistrationRow["status"];
  role?: RegistrationRole | null;
  attendanceStatus?: AttendanceStatus;
};

const mapRegistration = (r: PayloadRegistration): RegistrationRow => ({
  id: String(r.id),
  event_id: toId(r.event)!,
  user_id: toId(r.user)!,
  status: r.status,
  role: r.role ?? "participant",
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
): Promise<{ id: string; user_id: string; status: string; role: RegistrationRole; full_name: string; avatar_url: string | null }[]> {
  const where = buildWhereParams({
    event: { equals: eventId },
    status: { in: ["pending", "approved"] },
  });
  const result = await get<PayloadListResponse<PayloadRegistration>>(
    `/registrations?${where}&depth=0&limit=500`,
  );

  const userIds = Array.from(new Set(result.docs.map((r) => toId(r.user)).filter((v): v is string => Boolean(v))));
  const nameById = new Map<string, string>();
  let avatarByUser = new Map<string, string>();
  if (userIds.length) {
    const profileWhere = buildWhereParams({ user: { in: userIds } });
    const profiles = await get<PayloadListResponse<PayloadProfile>>(
      `/profiles?${profileWhere}&depth=0&limit=500`,
    );
    for (const p of profiles.docs) {
      const uid = toId(p.user);
      if (uid) nameById.set(uid, p.fullName);
    }
    avatarByUser = await getAvatarUrlsByUser(profiles.docs);
  }

  return result.docs.map((r) => ({
    id: String(r.id),
    user_id: toId(r.user)!,
    status: r.status,
    role: r.role ?? "participant",
    full_name: nameById.get(toId(r.user) ?? "") ?? "Účastník",
    avatar_url: avatarByUser.get(toId(r.user) ?? "") ?? null,
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
  role: RegistrationRole;
  attendance_status: AttendanceStatus;
  user_id: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
};

/** For ManageEvent.tsx — every registration for one event (any status), with name+phone. */
export async function getEventRegistrationsForManage(eventId: string): Promise<ManageRegistrationRow[]> {
  const where = buildWhereParams({ event: { equals: eventId } });
  const result = await get<PayloadListResponse<PayloadRegistration>>(
    `/registrations?${where}&depth=0&limit=500&sort=createdAt`,
  );

  const userIds = Array.from(new Set(result.docs.map((r) => toId(r.user)).filter((v): v is string => Boolean(v))));
  const infoById = new Map<string, { fullName: string; phone: string | null }>();
  let avatarByUser = new Map<string, string>();
  if (userIds.length) {
    const profileWhere = buildWhereParams({ user: { in: userIds } });
    const profiles = await get<PayloadListResponse<PayloadProfile>>(
      `/profiles?${profileWhere}&depth=0&limit=500`,
    );
    for (const p of profiles.docs) {
      const uid = toId(p.user);
      if (uid) infoById.set(uid, { fullName: p.fullName, phone: p.phone ?? null });
    }
    avatarByUser = await getAvatarUrlsByUser(profiles.docs);
  }

  return result.docs.map((r) => {
    const uid = toId(r.user)!;
    const info = infoById.get(uid);
    return {
      id: String(r.id),
      status: r.status,
      role: r.role ?? "participant",
      attendance_status: r.attendanceStatus ?? "not_marked",
      user_id: uid,
      full_name: info?.fullName ?? "Účastník",
      phone: info?.phone ?? null,
      avatar_url: avatarByUser.get(uid) ?? null,
    };
  });
}

/** The event's pořadatel marks what actually happened, on the manage-event page — once, for good.
 * Who marked it and when the server sets itself (Registrations lockAttendanceOnceMarked). */
export async function updateAttendance(registrationId: string, attendanceStatus: AttendanceStatus): Promise<void> {
  await patch(`/registrations/${registrationId}`, { attendanceStatus });
}

// --- Profiles -----------------------------------------------------------------------

export type ProfileRow = {
  id: string;
  full_name: string;
  avatar_url: string | null;
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
  volunteer_allow_email: boolean;
  volunteer_contact_email: string | null;
  volunteer_allow_phone: boolean;
  volunteer_contact_phone: string | null;
  /** Where they help as a volunteer — the obec that puts them on the volunteer map. */
  volunteer_municipality_id: string | null;
};

type PayloadProfile = {
  id: number;
  user: number | { id: number };
  fullName: string;
  avatar?: number | PayloadMedia | null;
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
  volunteerAllowEmail?: boolean | null;
  volunteerContactEmail?: string | null;
  volunteerAllowPhone?: boolean | null;
  volunteerContactPhone?: string | null;
  volunteerMunicipality?: number | { id: number } | null;
};

/** The square avatar crop, else the original — a photo smaller than the crop gets no crop. */
const avatarUrlOf = (media: number | PayloadMedia | null | undefined): string | null =>
  media && typeof media === "object" ? (media.sizes?.avatar?.url ?? media.url ?? null) : null;

/** Avatar URL per user id for a batch of depth-0 profiles — one media query instead of
 * populating each profile's relations (which would also drag their user docs along). */
async function getAvatarUrlsByUser(profiles: PayloadProfile[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const mediaIds = profiles.map((p) => toId(p.avatar as number | null)).filter((v): v is string => Boolean(v));
  if (mediaIds.length === 0) return urls;
  const where = buildWhereParams({ id: { in: mediaIds } });
  const media = await get<PayloadListResponse<PayloadMedia>>(`/media?${where}&depth=0&limit=500`);
  const urlByMedia = new Map(media.docs.map((m) => [String(m.id), avatarUrlOf(m)]));
  for (const p of profiles) {
    const uid = toId(p.user);
    const url = urlByMedia.get(toId(p.avatar as number | null) ?? "");
    if (uid && url) urls.set(uid, url);
  }
  return urls;
}

const mapProfile = (p: PayloadProfile): ProfileRow => ({
  id: String(p.id),
  full_name: p.fullName,
  avatar_url: avatarUrlOf(p.avatar),
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
  volunteer_allow_email: Boolean(p.volunteerAllowEmail),
  volunteer_contact_email: p.volunteerContactEmail ?? null,
  volunteer_allow_phone: Boolean(p.volunteerAllowPhone),
  volunteer_contact_phone: p.volunteerContactPhone ?? null,
  volunteer_municipality_id: toId(p.volunteerMunicipality),
});

export type VolunteerRow = {
  id: string;
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  /** Where they help — the obec that puts them on the volunteer map. */
  location: { id: string; name: string; lat: number; lng: number } | null;
  /** Only the channels the volunteer allowed — null otherwise. */
  phone: string | null;
  email: string | null;
  volunteer_focus: string[] | null;
  volunteer_note: string | null;
  volunteer_since: string | null;
  /** Their average rating from organizers, once anyone has rated them. */
  rating: { average: number; count: number } | null;
  /** The viewer may take them off the pool (a platform admin, or an admin of the obec they help in). */
  can_remove: boolean;
};

export type VolunteerDetail = {
  volunteer: VolunteerRow;
  /** The viewer is the volunteer themselves. */
  is_self: boolean;
  ratings: {
    id: string;
    rating: number;
    comment: string | null;
    event_id: string;
    event_title: string;
    rated_by_name: string;
    created_at: string;
    /** Only ever set for the volunteer themselves — where their complaint about the rating stands. */
    complaint_status: ReviewComplaintStatus;
    can_complain: boolean;
  }[];
  events: { id: string; title: string; date_time: string; location_text: string | null; upcoming: boolean; attended: boolean }[];
};

/** A volunteer's card — for the volunteer themselves and anyone who organizes. Null once they've left
 * the pool (the card disappears with it). */
export async function getVolunteerDetail(userId: string): Promise<VolunteerDetail | null> {
  try {
    return await get<VolunteerDetail>(`/volunteers/${userId}`);
  } catch (error) {
    if (error instanceof PayloadApiError && error.status === 404) return null;
    throw error;
  }
}

export type VolunteerRatingRow = { id: string; registration_id: string; rating: number; comment: string | null };

/** The ratings the pořadatel gave this event's volunteers, by registration. */
export async function getVolunteerRatingsForEvent(eventId: string): Promise<Map<string, VolunteerRatingRow>> {
  const where = buildWhereParams({ event: { equals: eventId } });
  const result = await get<
    PayloadListResponse<{ id: number; registration: number | { id: number }; rating: number; comment?: string | null }>
  >(`/volunteer-ratings?${where}&depth=0&limit=200`);
  return new Map(
    result.docs.map((r) => [
      toId(r.registration)!,
      { id: String(r.id), registration_id: toId(r.registration)!, rating: r.rating, comment: r.comment ?? null },
    ]),
  );
}

/** Rates a volunteer who helped on the event — once, for good. */
export async function rateVolunteer(registrationId: string, rating: number, comment: string): Promise<void> {
  await post("/volunteer-ratings", { registration: Number(registrationId), rating, comment: comment.trim() || undefined });
}

/** The whole platform's volunteer pool, for whoever organizes anywhere — through the scoped
 * /admin/volunteers endpoint, since the volunteer fields on a profile are the volunteer's own. */
export async function getVolunteers(): Promise<VolunteerRow[]> {
  const result = await get<{ docs: VolunteerRow[] }>("/admin/volunteers");
  return result.docs;
}

/** Takes someone off the pool (misuse, or they asked by phone) — joining is only ever their own. */
export async function removeVolunteer(userId: string): Promise<void> {
  await post("/admin/volunteers", { userId: Number(userId), isVolunteer: false });
}

// --- Volunteer invitations --------------------------------------------------------------------

/** Asks a volunteer from the pool to help run the event — they're on it once they accept. */
export async function inviteVolunteer(eventId: string, volunteerUserId: string, message: string): Promise<void> {
  await post("/volunteer-invitations", {
    event: Number(eventId),
    volunteer: Number(volunteerUserId),
    message: message.trim() || undefined,
  });
}

export type VolunteerInvitationRow = {
  id: string;
  event_id: string;
  event_title: string;
  event_date_time: string | null;
  event_location: string | null;
  invited_by_name: string;
  message: string | null;
};

type PayloadVolunteerInvitation = {
  id: number;
  event: number | { id: number; dateTime: string; locationText?: string | null } | null;
  eventTitle: string;
  invitedBy: number | { id: number };
  message?: string | null;
};

/** The volunteer's own invitations still waiting for their answer, soonest event first. */
export async function getMyVolunteerInvitations(userId: string): Promise<VolunteerInvitationRow[]> {
  // Only invitations — the volunteer's own offers to help are the creator's to answer.
  const where = buildWhereParams({
    volunteer: { equals: userId },
    status: { equals: "pending" },
    kind: { equals: "invitation" },
  });
  const result = await get<PayloadListResponse<PayloadVolunteerInvitation>>(
    `/volunteer-invitations?${where}&depth=1&limit=100`,
  );
  const names = await getFullNamesByUserIds(
    [...new Set(result.docs.map((r) => toId(r.invitedBy)).filter((v): v is string => Boolean(v)))],
  );
  return result.docs
    .map((r) => {
      const event = typeof r.event === "object" ? r.event : null;
      return {
        id: String(r.id),
        event_id: toId(r.event) ?? "",
        event_title: r.eventTitle,
        event_date_time: event?.dateTime ?? null,
        event_location: event?.locationText ?? null,
        invited_by_name: names.get(toId(r.invitedBy) ?? "") ?? "Pořadatel",
        message: r.message ?? null,
      };
    })
    .filter((r) => !r.event_date_time || new Date(r.event_date_time).getTime() > Date.now())
    .sort((a, b) => (a.event_date_time ?? "").localeCompare(b.event_date_time ?? ""));
}

/** Accepting puts the volunteer on the event (VolunteerInvitations applyDecision). */
export async function decideVolunteerInvitation(invitationId: string, accept: boolean): Promise<void> {
  await patch(`/volunteer-invitations/${invitationId}`, { status: accept ? "accepted" : "declined" });
}

// --- Offering to help as a volunteer (VolunteerInvitations kind "application") ----------------

/** Someone from the pool offers to help on an event flagged as volunteering — its creator answers. */
export async function offerVolunteerHelp(eventId: string, message: string): Promise<void> {
  await post("/volunteer-invitations", {
    kind: "application",
    event: Number(eventId),
    message: message.trim() || undefined,
  });
}

/** The volunteer takes back an offer the creator hasn't answered yet. */
export async function withdrawVolunteerOffer(applicationId: string): Promise<void> {
  await patch(`/volunteer-invitations/${applicationId}`, { status: "withdrawn" });
}

export type MyVolunteerRequest = {
  id: string;
  /** "invitation": the creator asked them; "application": they offered to help. */
  kind: "invitation" | "application";
  status: "pending" | "accepted" | "declined" | "withdrawn";
  message: string | null;
};

/** What stands between the viewer and helping on the event — a pending invitation or offer, or (so
 * they aren't left guessing) the creator having turned their last offer down. Null when nothing. */
export async function getMyVolunteerRequestForEvent(eventId: string, userId: string): Promise<MyVolunteerRequest | null> {
  const where = buildWhereParams({ event: { equals: eventId }, volunteer: { equals: userId } });
  const result = await get<
    PayloadListResponse<{ id: number; kind?: MyVolunteerRequest["kind"]; status: MyVolunteerRequest["status"]; message?: string | null }>
  >(`/volunteer-invitations?${where}&depth=0&sort=-createdAt&limit=10`);
  const row =
    result.docs.find((r) => r.status === "pending") ??
    result.docs.find((r) => r.kind === "application" && r.status === "declined");
  if (!row) return null;
  return { id: String(row.id), kind: row.kind ?? "invitation", status: row.status, message: row.message ?? null };
}

export type VolunteerOfferRow = {
  id: string;
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  message: string | null;
  volunteer_focus: string[] | null;
  /** Their average from organizers — what the creator weighs the offer by. */
  rating: { average: number; count: number } | null;
  created_at: string;
};

/** Pending offers to help on the event, oldest first — each with the volunteer's card from the pool
 * (name, photo, ratings). For everyone running it; the creator answers them. */
export async function getVolunteerOffersForEvent(eventId: string): Promise<VolunteerOfferRow[]> {
  const where = buildWhereParams({
    event: { equals: eventId },
    kind: { equals: "application" },
    status: { equals: "pending" },
  });
  const result = await get<
    PayloadListResponse<{ id: number; volunteer: number | { id: number }; message?: string | null; createdAt: string }>
  >(`/volunteer-invitations?${where}&depth=0&sort=createdAt&limit=100`);
  return Promise.all(
    result.docs.map(async (r) => {
      const userId = toId(r.volunteer) ?? "";
      const card = await getVolunteerDetail(userId).catch(() => null);
      return {
        id: String(r.id),
        user_id: userId,
        full_name: card?.volunteer.full_name ?? "Dobrovolník",
        avatar_url: card?.volunteer.avatar_url ?? null,
        message: r.message ?? null,
        volunteer_focus: card?.volunteer.volunteer_focus ?? null,
        rating: card?.volunteer.rating ?? null,
        created_at: r.createdAt,
      };
    }),
  );
}

/** Which of these events the volunteer is already on — registered (as a volunteer or participant,
 * approved or waiting) — so the pool's "Pozvat" doesn't offer them. */
export async function getEventIdsUserIsOn(userId: string, eventIds: string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const where = buildWhereParams({
    user: { equals: userId },
    status: { in: ["pending", "approved"] },
    event: { in: eventIds },
  });
  const result = await get<PayloadListResponse<{ event: number | { id: number } }>>(
    `/registrations?${where}&depth=0&limit=200`,
  );
  return new Set(result.docs.map((r) => toId(r.event)!).filter(Boolean));
}

/** Which of these events the volunteer already has a pending invitation or offer to help for — so
 * the pool's "Pozvat" doesn't offer them twice. */
export async function getPendingVolunteerInvitationEventIds(volunteerUserId: string, eventIds: string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const where = buildWhereParams({
    volunteer: { equals: volunteerUserId },
    status: { equals: "pending" },
    event: { in: eventIds },
  });
  const result = await get<PayloadListResponse<{ event: number | { id: number } }>>(
    `/volunteer-invitations?${where}&depth=0&limit=200`,
  );
  return new Set(result.docs.map((r) => toId(r.event)!).filter(Boolean));
}

export type VolunteerShiftRow = {
  registration_id: string;
  event_id: string;
  title: string;
  date_time: string;
  /** Leaving the pool turns the volunteer into a participant only where a place is free — on a full
   * event they'd drop off it (Profiles handleLeavingPool). */
  full: boolean;
};

/** The upcoming events the user helps on as a volunteer. */
export async function getMyVolunteerShifts(userId: string): Promise<VolunteerShiftRow[]> {
  const where = buildWhereParams({
    user: { equals: userId },
    role: { equals: "volunteer" },
    status: { in: ["pending", "approved"] },
  });
  const result = await get<PayloadListResponse<PayloadRegistration & { event: number | PayloadEvent }>>(
    `/registrations?${where}&depth=1&limit=100`,
  );
  const upcoming = result.docs
    .flatMap((r) =>
      typeof r.event === "object" && r.event && r.event.status !== "cancelled"
        ? [{ registration_id: String(r.id), event: r.event }]
        : [],
    )
    .filter((r) => new Date(r.event.dateTime).getTime() > Date.now());
  const counts = await getRegistrationCounts(upcoming.map((r) => String(r.event.id)));
  return upcoming
    .map(({ registration_id, event }) => ({
      registration_id,
      event_id: String(event.id),
      title: event.title,
      date_time: event.dateTime,
      full: (counts.get(String(event.id))?.approved ?? 0) >= event.capacity,
    }))
    .sort((a, b) => a.date_time.localeCompare(b.date_time));
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

/** An organization that can be invited to co-organize — with its own photo/logo, if it has one. */
export type CoOrganizerCandidate = OrganizationRef & { avatar_url: string | null };

/** For CoOrganizerPicker — every organization of this obec that can be invited to co-organize: the
 * obec's own first, then its pořadatelé's (never the requester's own). */
export async function listCoOrganizerCandidates(municipalityId: string): Promise<CoOrganizerCandidate[]> {
  const params = new URLSearchParams({ municipalityId });
  const result = await get<{ docs: CoOrganizerCandidate[] }>(`/events/co-organizer-candidates?${params}`);
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
  // depth=1 for the avatar's URL; every other relation is read through toId, object or not.
  const result = await get<PayloadListResponse<PayloadProfile>>(`/profiles?${where}&limit=1&depth=1`);
  return result.docs[0] ? mapProfile(result.docs[0]) : null;
}

export async function updateProfile(profileId: string, data: Record<string, unknown>): Promise<ProfileRow> {
  const doc = await patch<PayloadProfile>(`/profiles/${profileId}`, data);
  return mapProfile(doc);
}

/** Uploads a new profile photo and puts it on the profile. */
export async function setProfileAvatar(profileId: string, file: File, alt: string): Promise<void> {
  const uploaded = await uploadFile<{ id: number }>("media", file, { alt });
  await patch(`/profiles/${profileId}`, { avatar: uploaded.id });
}

export async function removeProfileAvatar(profileId: string): Promise<void> {
  await patch(`/profiles/${profileId}`, { avatar: null });
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

export type EventDeletionRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "requester-removed"
  | "escalated"
  | "escalation-rejected";

export type EventDeletionRequestRow = {
  id: string;
  status: EventDeletionRequestStatus;
  requested_by_id: string;
  approver_ids: string[];
  approved_by_ids: string[];
  /** The spolupořadatel who refused — after that the requester may turn to the obec. */
  rejected_by_id: string | null;
  /** The obec co-organizes the event — one of its admins has to consent for it too. */
  municipality_consent: boolean;
  municipality_approved: boolean;
  /** The others' deadline; once escalated, the event's start (the obec's). */
  expires_at: string;
};

type PayloadEventDeletionRequest = {
  id: number;
  status: EventDeletionRequestStatus;
  requestedBy: number | { id: number };
  approvers?: (number | { id: number })[] | null;
  approvedBy?: (number | { id: number })[] | null;
  rejectedBy?: number | { id: number } | null;
  municipalityConsent?: boolean | null;
  municipalityApprovedBy?: number | { id: number } | null;
  expiresAt: string;
};

/** The event's latest request to delete it, whatever became of it — still open, refused (its
 * requester may turn to the obec), with the obec, or settled. Lapsed ones read back "expired". */
export async function getLatestEventDeletionRequest(eventId: string): Promise<EventDeletionRequestRow | null> {
  const where = buildWhereParams({ event: { equals: eventId } });
  const result = await get<PayloadListResponse<PayloadEventDeletionRequest>>(
    `/event-deletion-requests?${where}&depth=0&limit=1&sort=-createdAt`,
  );
  const r = result.docs[0];
  if (!r) return null;
  const ids = (v: PayloadEventDeletionRequest["approvers"]) =>
    (v ?? []).map(toId).filter((x): x is string => Boolean(x));
  return {
    id: String(r.id),
    status: r.status,
    requested_by_id: toId(r.requestedBy)!,
    approver_ids: ids(r.approvers),
    approved_by_ids: ids(r.approvedBy),
    rejected_by_id: toId(r.rejectedBy ?? null),
    municipality_consent: Boolean(r.municipalityConsent),
    municipality_approved: Boolean(r.municipalityApprovedBy),
    expires_at: r.expiresAt,
  };
}

/** Asks the event's other organizers to consent to deleting it — they get notified. */
export async function requestEventDeletion(eventId: string): Promise<void> {
  await post("/event-deletion-requests", { event: Number(eventId) });
}

export type EventDeletionDecision = "approve" | "reject" | "remove-requester";

/** "approved" = everyone consented and the event is gone; "pending" = others still have to;
 * "requester-removed" = the event stays, without the requester. */
export async function decideEventDeletion(
  requestId: string,
  decision: EventDeletionDecision,
): Promise<{ status: "pending" | "approved" | "rejected" | "requester-removed" }> {
  return post(`/events/deletion-requests/${requestId}/decide`, { decision });
}

/** After a spolupořadatel refused, the requester asks the obec to take them off the event. */
export async function escalateEventDeletion(requestId: string): Promise<void> {
  await post(`/events/deletion-requests/${requestId}/escalate`, {});
}

/** The creator marks their event as one for volunteers, or takes the mark off — no obec approval.
 * Works even when the obec co-organizing the event has locked them out of editing it. */
export async function setEventVolunteering(eventId: string, isVolunteering: boolean): Promise<boolean> {
  const result = await post<{ isVolunteering: boolean }>(`/events/${eventId}/volunteering`, { isVolunteering });
  return result.isVolunteering;
}

// --- The viewer's organizations ("Organizace") ----------------------------------------------

export type MyOrganizationRow = {
  id: string;
  name: string;
  type: AnyOrganizationType;
  municipality_id: string;
  municipality_name: string;
  /** The viewer owns it and may rename it — the obec's own one carries the obec's name. */
  is_own: boolean;
  avatar_url: string | null;
  /** In the organization's own words — shown on its profile among the obec's organizers. */
  description: string | null;
};

type PayloadOrganizationWithMunicipality = PayloadOrganization & {
  municipality: number | { id: number; name: string };
};

/** What the viewer organizes as: their own organization in each obec they organize in, and the
 * organization of every obec they administer. The obec ones first — for its admin, that's the main one. */
export async function getMyOrganizations(userId: string, administeredMunicipalityIds: string[] = []): Promise<MyOrganizationRow[]> {
  const params = new URLSearchParams({ "where[or][0][owner][equals]": userId });
  if (administeredMunicipalityIds.length > 0) {
    params.set("where[or][1][and][0][type][equals]", MUNICIPALITY_ORGANIZATION_TYPE);
    administeredMunicipalityIds.forEach((id) => params.append("where[or][1][and][1][municipality][in][]", id));
  }
  const query = buildQuery({ sort: "name", depth: 1, limit: 100 });
  const result = await get<PayloadListResponse<PayloadOrganizationWithMunicipality>>(`/organizations?${params}&${query}`);
  return result.docs
    .map((o) => ({
      id: String(o.id),
      name: o.name,
      type: o.type,
      municipality_id: toId(o.municipality) ?? "",
      municipality_name: typeof o.municipality === "object" ? o.municipality.name : "",
      is_own: toId(o.owner) === userId,
      avatar_url: o.avatarUrl ?? null,
      description: o.description ?? null,
    }))
    .sort((a, b) => Number(b.type === MUNICIPALITY_ORGANIZATION_TYPE) - Number(a.type === MUNICIPALITY_ORGANIZATION_TYPE));
}

/** Every event the organization runs or co-organizes — any status or date, newest first. */
export async function getOrganizationEvents(organizationId: string): Promise<EventRow[]> {
  const params = new URLSearchParams({
    "where[or][0][organization][equals]": organizationId,
    "where[or][1][coOrganizations][in][]": organizationId,
  });
  const query = buildQuery({ sort: "-dateTime", depth: 1, limit: 500 });
  const result = await get<PayloadListResponse<PayloadEvent>>(`/events?${params}&${query}`);
  return result.docs.map(mapEvent);
}

export async function updateMyOrganization(
  id: string,
  input: { name: string; type: OrganizationType; description: string },
): Promise<void> {
  await patch(`/organizations/${id}`, input);
}

// --- "Organizátoři v mém městě" -------------------------------------------------------------

export type OrganizerProfileRow = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  avatar_url: string | null;
  owner_name: string | null;
  since: string;
  is_own: boolean;
  stats: { eventCount: number; coOrganizedCount: number; people: number; returning: number; fillRate: number | null };
  next_event: { id: string; title: string; date_time: string } | null;
  /** How to reach its owner — their account e-mail. */
  contact: { email: string | null };
};

/** Every organization organizing in the obec, with the numbers of its Organizace page (no ratings). */
export async function getMunicipalityOrganizers(municipalityId: string): Promise<OrganizerProfileRow[]> {
  return (await get<{ docs: OrganizerProfileRow[] }>(`/municipalities/${municipalityId}/organizers`)).docs;
}

/** Uploads a new photo/logo for the organization and puts it on it — every event it runs or
 * co-organizes shows it from then on. */
export async function setOrganizationAvatar(id: string, file: File, alt: string): Promise<void> {
  const uploaded = await uploadFile<{ id: number }>("media", file, { alt });
  await patch(`/organizations/${id}`, { avatar: uploaded.id });
}

export async function removeOrganizationAvatar(id: string): Promise<void> {
  await patch(`/organizations/${id}`, { avatar: null });
}

export type { OrganizationFeedbackSummary };

export async function getOrganizationFeedbackSummary(organizationId: string): Promise<OrganizationFeedbackSummary> {
  return get<OrganizationFeedbackSummary>(`/organizations/${organizationId}/feedback-summary`);
}

// --- Reviews and complaints about them --------------------------------------------------------

export type ReviewComplaintStatus = "pending" | "rejected" | null;

/** One participant's feedback on the organization's event — without who wrote it. */
export type OrganizationReviewRow = {
  id: string;
  event_id: string;
  event_title: string;
  event_date: string;
  satisfaction: number;
  felt_welcome: number | null;
  comment: string | null;
  created_at: string;
  complaint_status: ReviewComplaintStatus;
  can_complain: boolean;
};

export async function getOrganizationReviews(organizationId: string): Promise<OrganizationReviewRow[]> {
  const result = await get<{ docs: OrganizationReviewRow[] }>(`/organizations/${organizationId}/reviews`);
  return result.docs;
}

/** Reports a review to the obec the event belongs to — it decides whether to remove it. */
export async function reportReview(
  type: "event-feedback" | "volunteer-rating",
  reviewId: string,
  reason: string,
): Promise<void> {
  await post("/review-complaints", {
    reviewType: type,
    [type === "event-feedback" ? "eventFeedback" : "volunteerRating"]: Number(reviewId),
    reason: reason.trim(),
  });
}

// --- Invitations to co-organize ---------------------------------------------------------------

/** Invites an organization to co-organize the event — it joins once its owner (for the obec, one of
 * its admins) accepts. "approved" when the inviter answers for it themselves (the obec's admin
 * inviting the obec). */
export async function inviteCoOrganizer(eventId: string, organizationId: string): Promise<{ status: RequestStatus }> {
  const doc = await post<{ status: RequestStatus }>("/co-organizing-requests", {
    event: Number(eventId),
    organization: Number(organizationId),
  });
  return { status: doc.status };
}

type PayloadCoOrganizingInvitation = { organization: number | PayloadOrganization | null };

/** The organizations invited to co-organize this event that haven't answered yet (and still can). */
export async function getPendingCoOrganizers(eventId: string): Promise<OrganizationRef[]> {
  const where = buildWhereParams({
    event: { equals: eventId },
    status: { equals: "pending" },
    expiresAt: { greater_than: new Date().toISOString() },
  });
  const result = await get<PayloadListResponse<PayloadCoOrganizingInvitation>>(
    `/co-organizing-requests?${where}&depth=1&limit=100`,
  );
  return result.docs.map((r) => mapOrganization(r.organization)).filter((o): o is OrganizationRef => Boolean(o));
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
