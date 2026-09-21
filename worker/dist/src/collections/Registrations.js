import { APIError } from 'payload';
import { publishCapacityChange } from '@/lib/realtime/eventCapacity';
import { sendNotification } from './shared/notify';
import { scheduleParticipantReminder } from './shared/reminders';
import { getAdministeredMunicipalityIds, isLoggedIn, isPlatformOrMunicipalityAdmin } from './access/shared';
import { deletedAtField } from './shared/softDelete';
const REGISTRATION_STATUS_SUBJECT = {
    approved: 'Vaše přihláška byla schválena',
    rejected: 'Vaše přihláška byla zamítnuta',
};
/** Brief §8 live "Přihlásit se"/"Akce je plná" button — publish the event's new approved
 * count whenever a change could have added or removed someone from that count (a fresh
 * approval, or an existing approved registration being cancelled/rejected). Any other status
 * transition (pending -> rejected, cancelled -> pending, etc.) never touched the approved
 * count, so skip the publish rather than send a no-op update to every open detail page.
 *
 * US-P-08: the same count also drives the event's own `status` — flipped to 'full' once
 * approved registrations reach capacity, and back to 'active' once they drop below it again.
 * Never overwrites 'cancelled' or 'finished', which are terminal/time-driven, not capacity-driven. */
const broadcastCapacityChange = async ({ doc, previousDoc, operation, req }) => {
    const wasApproved = previousDoc?.status === 'approved';
    const isApproved = doc.status === 'approved';
    // On create there's no previousDoc, so only a create that lands straight in "approved"
    // (organizer-registers-own-event, or auto-approval mode) can have changed the count.
    const mayHaveChanged = operation === 'create' ? isApproved : wasApproved !== isApproved;
    if (!mayHaveChanged)
        return doc;
    const eventId = typeof doc.event === 'object' ? doc.event.id : doc.event;
    try {
        // Passing `req` matters: this write is still inside the current request's DB
        // transaction, so a count query on a fresh connection (no `req`) would run against the
        // pre-write snapshot and undercount the row that was just approved/unapproved.
        const result = await req.payload.count({
            collection: 'registrations',
            where: { and: [{ event: { equals: eventId } }, { status: { equals: 'approved' } }] },
            overrideAccess: true,
            req,
        });
        publishCapacityChange(eventId, result.totalDocs);
        const event = await req.payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true });
        if (event.status === 'active' || event.status === 'full') {
            const shouldBeFull = result.totalDocs >= event.capacity;
            const nextStatus = shouldBeFull ? 'full' : 'active';
            if (nextStatus !== event.status) {
                await req.payload.update({
                    collection: 'events',
                    id: eventId,
                    data: { status: nextStatus },
                    overrideAccess: true,
                    req,
                });
            }
        }
    }
    catch (error) {
        req.payload.logger.error(`Failed to broadcast capacity change for event ${eventId}: ${error}`);
    }
    return doc;
};
const notifyOnRegistrationChange = async ({ doc, previousDoc, operation, req, context, }) => {
    // Seeded demo registrations (src/lib/seed/run.ts) mustn't mail anyone or queue reminders.
    if (context?.skipNotifications)
        return doc;
    try {
        const userId = typeof doc.user === 'object' ? doc.user.id : doc.user;
        const eventId = typeof doc.event === 'object' ? doc.event.id : doc.event;
        const event = await req.payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true });
        const organizerId = typeof event.organizer === 'object' ? event.organizer.id : event.organizer;
        // Brief §7 "Přihlášení na akci → účastník" — confirmation on create, whatever status it
        // landed in (auto-approved, or pending an organizer's review).
        if (operation === 'create') {
            const isSelfOrganizing = String(organizerId) === String(userId);
            if (!isSelfOrganizing) {
                const pending = doc.status === 'pending';
                await sendNotification(req.payload, {
                    userId,
                    title: pending ? 'Přihláška odeslána' : 'Přihláška potvrzena',
                    message: pending
                        ? `Vaše přihláška na akci „${event.title}“ čeká na schválení organizátorem.`
                        : `Jste přihlášeni na akci „${event.title}“.`,
                    link: `/akce/${eventId}`,
                    email: {
                        subject: pending ? `Přihláška odeslána: ${event.title}` : `Přihláška potvrzena: ${event.title}`,
                        body: pending
                            ? `<p>Vaše přihláška na akci <strong>${event.title}</strong> čeká na schválení organizátorem.</p>`
                            : `<p>Jste přihlášeni na akci <strong>${event.title}</strong>.</p>`,
                    },
                });
                // Brief §7 "Nové přihlášení na akci → organizátor".
                await sendNotification(req.payload, {
                    userId: organizerId,
                    title: 'Nová přihláška na akci',
                    message: `Někdo se přihlásil na vaši akci „${event.title}“.`,
                    link: `/akce/${eventId}`,
                    email: {
                        subject: `Nová přihláška: ${event.title}`,
                        body: `<p>Někdo se přihlásil na vaši akci <strong>${event.title}</strong>.</p>`,
                    },
                });
            }
            return doc;
        }
        if (operation !== 'update' || doc.status === previousDoc?.status)
            return doc;
        // Task 9: a participant cancelling their own registration notifies the organizer — not
        // when the organizer/admin is the one who set it to "cancelled" (e.g. via the manage-event
        // table), only when someone else did.
        if (doc.status === 'cancelled') {
            if (String(req.user?.id) !== String(organizerId)) {
                await sendNotification(req.payload, {
                    userId: organizerId,
                    title: 'Přihláška zrušena',
                    message: `Někdo zrušil svou přihlášku na vaši akci „${event.title}“.`,
                    link: `/akce/${eventId}`,
                    email: {
                        subject: `Zrušená přihláška: ${event.title}`,
                        body: `<p>Někdo zrušil svou přihlášku na vaši akci <strong>${event.title}</strong>.</p>`,
                    },
                });
            }
            return doc;
        }
        if (!REGISTRATION_STATUS_SUBJECT[doc.status])
            return doc;
        const approved = doc.status === 'approved';
        await sendNotification(req.payload, {
            userId,
            link: `/akce/${eventId}`,
            title: REGISTRATION_STATUS_SUBJECT[doc.status],
            message: approved
                ? `Vaše přihláška na akci „${event.title}“ byla schválena.`
                : `Vaše přihláška na akci „${event.title}“ byla bohužel zamítnuta.`,
            email: {
                subject: `${REGISTRATION_STATUS_SUBJECT[doc.status]}: ${event.title}`,
                body: approved
                    ? `<p>Vaše přihláška na akci <strong>${event.title}</strong> byla schválena.</p>`
                    : `<p>Vaše přihláška na akci <strong>${event.title}</strong> byla bohužel zamítnuta.</p>`,
            },
        });
        // 24h reminder — scheduled at approval time (brief §A5: "levné a užitečné"), and moved
        // along with the event if it's rescheduled later (see shared/reminders.ts).
        if (approved) {
            await scheduleParticipantReminder(req.payload, doc.id, userId, event);
        }
    }
    catch (error) {
        req.payload.logger.error(`Failed to notify on registration change: ${error}`);
    }
    return doc;
};
/** Registrations a user may act on: their own (to register/cancel), or any belonging to an
 * event they organize/co-organize or whose municipality they administer (to approve/reject
 * and mark attendance). Shared by read and update access — resolved to plain event ids up
 * front instead of `event.organizer` / `event.coOrganizers` paths inside the access query,
 * since OR-ing several relationship joins there matched every row. */
const ownOrManagedRegistrationsWhere = async (req) => {
    const { user, payload } = req;
    const administeredIds = await getAdministeredMunicipalityIds(payload, user.id);
    const manageableEventsWhere = [{ organizer: { equals: user.id } }, { coOrganizers: { in: [user.id] } }];
    if (administeredIds.length > 0)
        manageableEventsWhere.push({ municipality: { in: administeredIds } });
    const manageableEvents = await payload.find({
        collection: 'events',
        where: { or: manageableEventsWhere },
        select: { organizer: true },
        depth: 0,
        pagination: false,
        overrideAccess: true,
        req,
    });
    const or = [{ user: { equals: user.id } }];
    if (manageableEvents.docs.length > 0)
        or.push({ event: { in: manageableEvents.docs.map((e) => e.id) } });
    return { or };
};
/** "Kdo dále jde" is only for the event's organizer and the obec's admin — a registration is
 * readable by the registrant themself, the event's organizer/co-organizers, an admin of the event's
 * municipality and a platform admin. Everyone else gets participant counts only, via the public
 * /api/events/registration-counts route. */
const canReadRegistration = async ({ req }) => {
    if (!req.user)
        return false;
    const visible = { deletedAt: { exists: false } };
    if (req.user.role === 'admin')
        return visible;
    return { and: [visible, await ownOrManagedRegistrationsWhere(req)] };
};
/** Approving/rejecting/marking attendance is limited the same way as reading (event's
 * organizer/co-organizers, the municipality's admin, or a platform admin); a participant may
 * additionally update their own registration to cancel it. Without this, `isLoggedIn` alone let
 * any logged-in user PATCH any registration in the system, including other people's. */
const canUpdateRegistration = async ({ req }) => {
    if (!req.user)
        return false;
    if (req.user.role === 'admin')
        return true;
    return ownOrManagedRegistrationsWhere(req);
};
export const Registrations = {
    slug: 'registrations',
    labels: {
        singular: 'Registration',
        plural: 'Registrations',
    },
    admin: {
        useAsTitle: 'id',
        defaultColumns: ['event', 'user', 'status', 'attendanceStatus', 'updatedAt'],
    },
    access: {
        read: canReadRegistration,
        create: isLoggedIn,
        update: canUpdateRegistration,
        // Platform superadmin everywhere, or a municipality admin scoped to their own
        // municipality (traverses the relationship: registration -> event -> municipality).
        delete: isPlatformOrMunicipalityAdmin('event.municipality'),
    },
    fields: [
        {
            name: 'event',
            type: 'relationship',
            relationTo: 'events',
            required: true,
        },
        {
            name: 'user',
            type: 'relationship',
            relationTo: 'users',
            required: true,
        },
        {
            name: 'status',
            type: 'select',
            required: true,
            defaultValue: 'pending',
            options: [
                { label: 'Pending', value: 'pending' },
                { label: 'Approved', value: 'approved' },
                { label: 'Rejected', value: 'rejected' },
                { label: 'Cancelled', value: 'cancelled' },
            ],
            admin: {
                description: '"Smí přijít" — whether the registration itself is allowed, not whether they attended.',
            },
        },
        {
            name: 'attendanceStatus',
            type: 'select',
            defaultValue: 'not_marked',
            options: [
                { label: 'Not marked', value: 'not_marked' },
                { label: 'Attended', value: 'attended' },
                { label: 'No-show', value: 'no_show' },
                { label: 'Excused', value: 'excused' },
            ],
            admin: {
                description: 'What actually happened — set by the organizer after the event, on the manage-event page.',
            },
        },
        {
            name: 'attendanceMarkedAt',
            type: 'date',
            admin: { position: 'sidebar' },
        },
        {
            name: 'attendanceMarkedBy',
            type: 'relationship',
            relationTo: 'users',
            admin: {
                description: 'The organizer who marked attendance.',
                position: 'sidebar',
            },
        },
        {
            name: 'attendanceNote',
            type: 'text',
            admin: { position: 'sidebar' },
        },
        deletedAtField,
    ],
    hooks: {
        beforeValidate: [
            async ({ data, req, operation, originalDoc }) => {
                if (!data?.event || !data?.user)
                    return data;
                if (operation === 'update' && originalDoc?.event === data.event && originalDoc?.user === data.user) {
                    return data;
                }
                // A cancelled registration doesn't block re-registering — both rows stay in
                // history (cancel + re-register), which matches append-only event tracking (brief §A2)
                // better than the old hard-delete-and-recreate flow did.
                const existing = await req.payload.find({
                    collection: 'registrations',
                    where: {
                        and: [
                            { event: { equals: data.event } },
                            { user: { equals: data.user } },
                            { status: { not_equals: 'cancelled' } },
                        ],
                    },
                    limit: 1,
                });
                if (existing.docs.length > 0) {
                    throw new Error('This user is already registered for this event.');
                }
                if (operation === 'create') {
                    const event = await req.payload.findByID({
                        collection: 'events',
                        id: data.event,
                        depth: 0,
                        overrideAccess: true,
                    });
                    const organizerIds = [event.organizer, ...(event.coOrganizers ?? [])].map((u) => String(typeof u === 'object' ? u.id : u));
                    // The organizer (and co-organizers) take part in their own event automatically — a
                    // registration would only use up one of the participants' spots.
                    if (organizerIds.includes(String(data.user))) {
                        throw new APIError('Tuto akci pořádáte — na vlastní akci se nepřihlašujete, počítá se s vámi automaticky a nezabíráte místo účastníkům.', 400);
                    }
                    if (event.registrationApprovalMode === 'auto') {
                        // Brief §4/§8 — "auto" registers everyone immediately, so the capacity check has
                        // to happen server-side here, not just as a disabled button on the frontend (that
                        // read can be stale). What happens to a signup that arrives once it's already full
                        // under "auto" (waitlist vs. hard reject) is still an open question (brief §8) —
                        // for now it's a hard reject, the simplest safe behavior.
                        const activeCount = await req.payload.count({
                            collection: 'registrations',
                            where: {
                                and: [{ event: { equals: data.event } }, { status: { in: ['pending', 'approved'] } }],
                            },
                            overrideAccess: true,
                        });
                        if (activeCount.totalDocs >= event.capacity) {
                            throw new Error('This event is already at full capacity.');
                        }
                        data.status = 'approved';
                    }
                }
                return data;
            },
        ],
        afterChange: [notifyOnRegistrationChange, broadcastCapacityChange],
    },
    timestamps: true,
};
