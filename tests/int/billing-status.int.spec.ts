// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueSms: vi.fn(async () => undefined),
  enqueueEventUpdated: vi.fn(async () => undefined),
  enqueueEventCancelled: vi.fn(async () => undefined),
  enqueueImportEvents: vi.fn(async () => undefined),
}))

import { nextBillingStepAt, servicesHeld, SUSPENDED_GRACE_DAYS } from '@/lib/billing/status'
import { advanceBillingStatuses } from '@/lib/billing/status-step'

let payload: Payload
const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

/**
 * Pozastavená obec (lib/billing/status): suspended → after 30 days read-only by itself, warned a week
 * ahead; read-only refuses what the obec's people write through the API (overrideAccess: false) but
 * lets a cancellation, the app's own trusted writes and the platform through.
 */
describe('Billing status — suspended, then read-only', () => {
  let obec: { id: number }
  let category: { id: number }
  let admin: { id: number; email: string; role: string }
  let platform: { id: number; email: string; role: string }
  let resident: { id: number; email: string; role: string }
  const userIds: number[] = []

  const as = (u: { id: number; email: string; role: string }) => ({
    user: { ...u, collection: 'users' as const },
    overrideAccess: false as const,
  })
  const setObec = (data: Record<string, unknown>) =>
    payload.update({ collection: 'municipalities', id: obec.id, data, overrideAccess: true })
  const readObec = () => payload.findByID({ collection: 'municipalities', id: obec.id, depth: 0, overrideAccess: true })
  const makeUser = async (name: string, role: 'user' | 'admin' = 'user') => {
    const u = (await payload.create({
      collection: 'users',
      data: { email: `bstatus-${name}-${STAMP}@test.local`, password: 'test1234', role },
      overrideAccess: true,
    })) as { id: number; email: string; role: string }
    userIds.push(u.id)
    return u
  }
  const eventData = () => ({
    title: `Read-only event ${STAMP}`,
    dateTime: new Date(Date.now() + 5 * DAY).toISOString(),
    locationText: 'Náves',
    lat: 49.4,
    lng: 15.2,
    capacity: 10,
    organizer: admin.id,
    municipality: obec.id,
    categories: [category.id],
    status: 'active' as const,
    isPaid: false,
    registrationApprovalMode: 'manual' as const,
  })
  const createEvent = () =>
    payload.create({ collection: 'events', data: eventData(), context: { skipNotifications: true }, overrideAccess: true })
  const noticesFor = async (title: string) =>
    (
      await payload.find({
        collection: 'notifications',
        where: { and: [{ user: { equals: admin.id } }, { title: { equals: title } }] },
        pagination: false,
        overrideAccess: true,
      })
    ).docs

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    obec = await payload.create({
      collection: 'municipalities',
      data: { name: `Billing status obec ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers' },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Billing status category ${STAMP}` },
      overrideAccess: true,
    })
    admin = await makeUser('admin')
    platform = await makeUser('root', 'admin')
    resident = await makeUser('resident')
    await payload.create({
      collection: 'user-roles',
      data: { user: admin.id, municipality: obec.id, role: 'municipality_admin' },
      overrideAccess: true,
    })
  }, 120_000)

  afterAll(async () => {
    await payload.delete({ collection: 'pool-invitations', where: { municipality: { equals: obec.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', where: { municipality: { equals: obec.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: obec.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    for (const id of userIds) await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
  })

  it('holds SMS and import for both suspended and read-only; dates the next step', () => {
    expect(servicesHeld('active')).toBe(false)
    expect(servicesHeld('suspended')).toBe(true)
    expect(servicesHeld('read_only')).toBe(true)
    const from = '2026-01-01T00:00:00.000Z'
    expect(nextBillingStepAt('suspended', from)?.toISOString()).toBe('2026-01-31T00:00:00.000Z')
    expect(nextBillingStepAt('read_only', from)?.toISOString()).toBe('2026-03-02T00:00:00.000Z')
    expect(nextBillingStepAt('active', from)).toBeNull()
    expect(nextBillingStepAt('suspended', null)).toBeNull()
  })

  it('the platform suspending the obec starts the clock and tells its admins', async () => {
    const before = Date.now()
    await payload.update({ collection: 'municipalities', id: obec.id, data: { billingStatus: 'suspended' }, ...as(platform) })
    const after = await readObec()
    expect(after.billingStatus).toBe('suspended')
    expect(new Date(after.billingStatusChangedAt!).getTime()).toBeGreaterThanOrEqual(before - 1000)
    await vi.waitFor(async () => expect(await noticesFor('Licence obce je pozastavená')).toHaveLength(1))
    // Saving other fields leaves the clock as it was.
    await payload.update({ collection: 'municipalities', id: obec.id, data: { billingNote: 'upomínka' }, ...as(platform) })
    expect((await readObec()).billingStatusChangedAt).toBe(after.billingStatusChangedAt)
  })

  it('warns once a week ahead, then turns read-only after the grace period', async () => {
    const now = new Date()
    await setObec({ billingStatusChangedAt: new Date(now.getTime() - (SUSPENDED_GRACE_DAYS - 5) * DAY).toISOString(), billingWarnedAt: null })
    expect(await advanceBillingStatuses(payload, now)).toMatchObject({ warned: 1, madeReadOnly: 0 })
    expect((await advanceBillingStatuses(payload, now)).warned).toBe(0)
    await vi.waitFor(async () => expect(await noticesFor('Obec brzy přejde do režimu jen pro čtení')).toHaveLength(1))
    expect((await readObec()).billingStatus).toBe('suspended')

    await setObec({ billingStatusChangedAt: new Date(now.getTime() - (SUSPENDED_GRACE_DAYS + 1) * DAY).toISOString() })
    expect((await advanceBillingStatuses(payload, now)).madeReadOnly).toBe(1)
    const readOnly = await readObec()
    expect(readOnly.billingStatus).toBe('read_only')
    // The read-only period's clock starts now.
    expect(new Date(readOnly.billingStatusChangedAt!).getTime()).toBeGreaterThan(now.getTime() - 60_000)
    await vi.waitFor(async () => expect(await noticesFor('Obec je v režimu jen pro čtení')).toHaveLength(1))
  })

  it('a suspension without a clock gets one started', async () => {
    await setObec({ billingStatus: 'suspended' })
    // Cleared by hand — as for an obec suspended before the field existed.
    await setObec({ billingStatusChangedAt: null })
    expect((await advanceBillingStatuses(payload)).clockStarted).toBeGreaterThanOrEqual(1)
    expect((await readObec()).billingStatusChangedAt).toBeTruthy()
    await setObec({ billingStatus: 'read_only' })
  })

  it('read-only: its admin creates and edits nothing, nor recruits — but may cancel an event', async () => {
    await setObec({ billingStatus: 'read_only' })
    await expect(payload.create({ collection: 'events', data: eventData(), ...as(admin) })).rejects.toThrow(/jen pro čtení/)

    const event = await createEvent()
    await expect(
      payload.update({ collection: 'events', id: event.id, data: { title: 'Nový název' }, ...as(admin) }),
    ).rejects.toThrow(/jen pro čtení/)
    // An edit riding along with a cancellation is still an edit.
    await expect(
      payload.update({ collection: 'events', id: event.id, data: { status: 'cancelled', title: 'x' }, ...as(admin) }),
    ).rejects.toThrow(/jen pro čtení/)

    await expect(
      payload.create({
        collection: 'pool-invitations',
        data: { user: resident.id, municipality: obec.id } as never,
        ...as(admin),
      }),
    ).rejects.toThrow(/jen pro čtení/)
    await expect(
      payload.update({ collection: 'municipalities', id: obec.id, data: { description: 'změna' }, ...as(admin) }),
    ).rejects.toThrow(/jen pro čtení/)

    const cancelled = await payload.update({
      collection: 'events',
      id: event.id,
      data: { deletedAt: new Date().toISOString(), status: 'cancelled' },
      ...as(admin),
    })
    expect(cancelled.status).toBe('cancelled')
  })

  it('its admin cannot lift the suspension, nor stop or reset its clock, through the API', async () => {
    const changedAt = new Date(Date.now() - 20 * DAY).toISOString()
    await setObec({ billingStatus: 'suspended' })
    await setObec({ billingStatusChangedAt: changedAt, billingWarnedAt: null })
    await payload.update({
      collection: 'municipalities',
      id: obec.id,
      data: {
        billingStatus: 'active',
        billingStatusChangedAt: new Date().toISOString(),
        billingWarnedAt: new Date().toISOString(),
        description: 'jen popis',
      } as never,
      ...as(admin),
    })
    const after = await readObec()
    expect(after.billingStatus).toBe('suspended')
    expect(after.billingStatusChangedAt).toBe(changedAt)
    expect(after.billingWarnedAt ?? null).toBeNull()
    expect(after.description).toBe('jen popis')
    // Nor through a bulk update.
    await payload.update({
      collection: 'municipalities',
      where: { id: { equals: obec.id } },
      data: { billingStatus: 'active' } as never,
      ...as(admin),
    })
    expect((await readObec()).billingStatus).toBe('suspended')
    // Nor can it see the fields at all.
    const asAdmin = await payload.findByID({ collection: 'municipalities', id: obec.id, ...as(admin) })
    expect(asAdmin.billingStatus).toBeUndefined()
    expect(asAdmin.billingStatusChangedAt).toBeUndefined()
  })

  it('read-only: no new invitation or request slips through, a pending one cannot be accepted, declining works', async () => {
    await setObec({ billingStatus: 'active' })
    const event = await createEvent()
    // Made while the obec still paid.
    // Straight into the database — as if invited (and checked) while the obec still paid.
    const pool = (await payload.db.create({
      collection: 'pool-invitations',
      data: { user: resident.id, municipality: obec.id, invitedBy: admin.id, status: 'pending' },
    })) as { id: number }
    await setObec({ billingStatus: 'read_only' })

    await expect(
      payload.create({
        collection: 'volunteer-invitations',
        data: { event: event.id, volunteer: resident.id, kind: 'application' } as never,
        ...as(resident),
      }),
    ).rejects.toThrow(/jen pro čtení/)
    await expect(
      payload.update({ collection: 'pool-invitations', id: pool.id, data: { status: 'accepted' }, ...as(resident) }),
    ).rejects.toThrow(/jen pro čtení/)
    const declined = await payload.update({
      collection: 'pool-invitations',
      id: pool.id,
      data: { status: 'declined' },
      ...as(resident),
    })
    expect(declined.status).toBe('declined')
  })

  it("read-only: the app's own writes on someone's behalf and the platform still go through", async () => {
    await setObec({ billingStatus: 'read_only' })
    const event = await createEvent()
    // e.g. a registration flipping the event to full — overrideAccess with the person in req.
    await payload.update({
      collection: 'events',
      id: event.id,
      data: { capacity: 12 },
      user: { ...admin, collection: 'users' },
      overrideAccess: true,
    })
    const edited = await payload.update({ collection: 'events', id: event.id, data: { title: 'Platforma' }, ...as(platform) })
    expect(edited.title).toBe('Platforma')

    // Back to active — the admin writes again.
    await payload.update({ collection: 'municipalities', id: obec.id, data: { billingStatus: 'active' }, ...as(platform) })
    const again = await payload.update({ collection: 'events', id: event.id, data: { title: 'Zase aktivní' }, ...as(admin) })
    expect(again.title).toBe('Zase aktivní')
  })
})
