/**
 * Query functions specific to the Admin dashboard (src/pages/Admin.tsx and
 * src/components/admin/*). Shaped to match src/lib/analytics.ts's EventRow/
 * RegistrationRow/CategoryRow/ProfileRow interfaces directly, since those pure
 * client-side analytics functions are unaware of Payload and expect that exact shape.
 */
import { buildQuery, buildWhereParams, get, patch } from "./client";

import type { PayloadListResponse } from "./client";
import type { EventRow, RegistrationRow, CategoryRow, ProfileRow } from "@/lib/analytics";
import type { ProfileWithDob } from "@/lib/report";

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
  category?: number | { id: number } | null;
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
    category_id: toId(e.category),
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
  paymentStatus?: string;
  amountPaidCents?: number | null;
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
    payment_status: r.paymentStatus,
    amount_paid_cents: r.amountPaidCents ?? null,
    attendance_status: (r.attendanceStatus ?? "not_marked") as RegistrationRow["attendance_status"],
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
