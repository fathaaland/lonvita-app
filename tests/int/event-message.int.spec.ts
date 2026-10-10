// @vitest-environment node
// Node environment: payload.login signs a JWT with jose, which rejects jsdom's Uint8Array.
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

// Captured, not sent — to check what goes out by SMS and by e-mail.
vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueSms: vi.fn(async () => undefined),
}))

import { enqueueEmail, enqueueSms } from '@/lib/queue/queues'

import { POST as sendMessage } from '@/app/api/events/[id]/message/route'

let payload: Payload

const STAMP = Date.now()
const HOUR = 60 * 60 * 1000

type TestUser = { id: number; email: string; role: string }

describe("The event's team writes to everyone signed up — even in the last 3 hours", () => {
  let municipality: { id: number }
  let category: { id: number }
  let organizer: TestUser
  let approved: TestUser
  let pending: TestUser
  let cancelled: TestUser
  let stranger: TestUser
  const eventIds: number[] = []

  const makeUser = (name: string) =>
    payload.create({
      collection: 'users',
      data: { email: `message-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    }) as Promise<TestUser>

  const createEvent = async (startsIn: number) => {
    const event = await payload.db.create({
      collection: 'events',
      data: {
        title: `Message ${STAMP}`,
        dateTime: new Date(Date.now() + startsIn).toISOString(),
        locationText: 'Náves',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: organizer.id,
        municipality: municipality.id,
        categories: [category.id],
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
      },
    })
    eventIds.push(event.id)
    for (const [user, status] of [
      [approved, 'approved'],
      [pending, 'pending'],
      [cancelled, 'cancelled'],
    ] as const) {
      await payload.db.create({ collection: 'registrations', data: { event: event.id, user: user.id, status, role: 'participant' } })
    }
    return event
  }

  const post = async (as: TestUser, eventId: number, message: string) => {
    const { token } = await payload.login({ collection: 'users', data: { email: as.email, password: 'test1234' } })
    return sendMessage(
      new Request(`http://localhost/api/events/${eventId}/message`, {
        method: 'POST',
        headers: { Authorization: `JWT ${token}`, 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${as.id % 250}` },
        body: JSON.stringify({ message }),
      }),
      { params: Promise.resolve({ id: String(eventId) }) },
    )
  }

  const noticesFor = async (user: TestUser) =>
    (
      await payload.find({
        collection: 'notifications',
        where: { user: { equals: user.id } },
        overrideAccess: true,
      })
    ).docs

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Message Muni ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    category = await payload.create({ collection: 'event-categories', data: { name: `Message Cat ${STAMP}` }, overrideAccess: true })
    organizer = await makeUser('organizer')
    approved = await makeUser('approved')
    pending = await makeUser('pending')
    cancelled = await makeUser('cancelled')
    stranger = await makeUser('stranger')
    // Has a phone — and still gets no SMS: those go out only when an event is cancelled.
    await payload.create({
      collection: 'profiles',
      data: { user: approved.id, fullName: 'Message approved', municipality: municipality.id, phone: '735 929 442' },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    const userIds = [organizer, approved, pending, cancelled, stranger].map((u) => u.id)
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'registrations', where: { event: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { id: { in: eventIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true }).catch(() => {})
  })

  it('reaches the approved and pending registrants, not who cancelled — an hour before the start', async () => {
    const event = await createEvent(1 * HOUR)
    const response = await post(organizer, event.id, 'Sraz se přesouvá před hasičárnu.')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ recipients: 2 })

    const [notice] = await noticesFor(approved)
    expect(notice.message).toContain('Sraz se přesouvá před hasičárnu.')
    expect(notice.link).toBe(`/akce/${event.id}`)
    expect(await noticesFor(pending)).toHaveLength(1)
    expect(await noticesFor(cancelled)).toHaveLength(0)
    expect(vi.mocked(enqueueEmail)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(enqueueSms)).not.toHaveBeenCalled()
  })

  it('is for the team only', async () => {
    const event = await createEvent(5 * HOUR)
    expect((await post(stranger, event.id, 'Ahoj všichni')).status).toBe(403)
    expect((await post(approved, event.id, 'Ahoj všichni')).status).toBe(403)
  })

  it('needs something to say, and not after the event', async () => {
    const event = await createEvent(5 * HOUR)
    expect((await post(organizer, event.id, '   ')).status).toBe(400)
    const over = await createEvent(-5 * HOUR)
    expect((await post(organizer, over.id, 'Díky, že jste přišli!')).status).toBe(409)
  })
})
