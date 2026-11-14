// @vitest-environment node
import { inflateRawSync } from 'node:zlib'

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

import { READ_ONLY_DAYS, TERMINATED_DAYS, nextBillingStepAt } from '@/lib/billing/status'
import { advanceBillingStatuses } from '@/lib/billing/status-step'
import { canRequestExport } from '@/lib/exports/access'
import { buildMunicipalityArchive } from '@/lib/exports/municipality-archive'

let payload: Payload
const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

type TestUser = { id: number; email: string; role: string }

/** The files of a ZIP, read back through its central directory. */
function unzip(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>()
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buf.readUInt16LE(end + 10)
  let at = buf.readUInt32LE(end + 16)
  for (let i = 0; i < count; i++) {
    const size = buf.readUInt32LE(at + 20)
    const nameLength = buf.readUInt16LE(at + 28)
    const extra = buf.readUInt16LE(at + 30)
    const comment = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    files.set(name, inflateRawSync(buf.subarray(dataStart, dataStart + size)).toString('utf8'))
    at += 46 + nameLength + extra + comment
  }
  return files
}

/**
 * Konec smlouvy (lib/billing/status): read-only → terminated after its period (or by hand) — still
 * read-only, the obec downloads all its data; a week before the end its later events are cancelled;
 * after TERMINATED_DAYS everything of the obec is erased, its residents keep their accounts.
 */
describe('Contract end — terminated, export, erasure', () => {
  let category: { id: number }
  let admin: TestUser
  let platform: TestUser
  let resident: TestUser
  const userIds: number[] = []
  const obecIds: number[] = []

  const as = (u: TestUser) => ({ user: { ...u, collection: 'users' as const }, overrideAccess: false as const })
  const makeUser = async (name: string, role: 'user' | 'admin' = 'user') => {
    const u = (await payload.create({
      collection: 'users',
      data: { email: `contract-${name}-${STAMP}@test.local`, password: 'test1234', role },
      overrideAccess: true,
    })) as TestUser
    userIds.push(u.id)
    return u
  }
  const makeObec = async (name: string) => {
    const obec = await payload.create({
      collection: 'municipalities',
      data: { name: `Contract ${name} ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers' },
      overrideAccess: true,
    })
    obecIds.push(obec.id)
    // One obec per admin — each obec here gets its own.
    admin = await makeUser(`admin-${name}`)
    await payload.create({ collection: 'profiles', data: { user: admin.id, fullName: 'Admin Obce' } as never, overrideAccess: true })
    await payload.create({
      collection: 'user-roles',
      data: { user: admin.id, municipality: obec.id, role: 'municipality_admin' },
      overrideAccess: true,
    })
    return obec
  }
  const setObec = (id: number, data: Record<string, unknown>) =>
    payload.update({ collection: 'municipalities', id, data, overrideAccess: true })
  /** The platform's confirmation for the stage the obec is in now (what POST …/erasure stores). */
  const confirmErasure = async (id: number) => {
    const obec = await payload.findByID({ collection: 'municipalities', id, depth: 0, overrideAccess: true })
    await setObec(id, { erasureConfirmedStage: obec.billingStatusChangedAt })
  }
  const readObec = (id: number) =>
    payload.findByID({ collection: 'municipalities', id, depth: 0, overrideAccess: true }).catch(() => null)
  const createEvent = (municipality: number, startsIn: number, title = `Contract event ${STAMP}`) =>
    payload.create({
      collection: 'events',
      data: {
        title,
        dateTime: new Date(Date.now() + startsIn).toISOString(),
        locationText: 'Náves',
        lat: 49.4,
        lng: 15.2,
        capacity: 10,
        organizer: admin.id,
        municipality,
        categories: [category.id],
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
      },
      context: { skipNotifications: true },
      overrideAccess: true,
    })
  const readEvent = (id: number) => payload.findByID({ collection: 'events', id, depth: 0, overrideAccess: true }).catch(() => null)
  const noticesFor = async (user: TestUser, title: string) =>
    (
      await payload.find({
        collection: 'notifications',
        where: { and: [{ user: { equals: user.id } }, { title: { equals: title } }] },
        pagination: false,
        overrideAccess: true,
      })
    ).docs

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Contract category ${STAMP}` },
      overrideAccess: true,
    })
    platform = await makeUser('root', 'admin')
    resident = await makeUser('resident')
  }, 120_000)

  afterAll(async () => {
    for (const id of obecIds) {
      await payload.delete({ collection: 'events', where: { municipality: { equals: id } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'municipalities', id, overrideAccess: true }).catch(() => {})
    }
    await payload.delete({ collection: 'notifications', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    for (const id of userIds) await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
  })

  it('dates the erasure 90 days after the contract ended', () => {
    expect(nextBillingStepAt('terminated', '2026-01-01T00:00:00.000Z')?.toISOString()).toBe(
      new Date(Date.parse('2026-01-01T00:00:00.000Z') + TERMINATED_DAYS * DAY).toISOString(),
    )
  })

  it('a read-only obec past its period is terminated; its admins and residents are told; it stays read-only', async () => {
    const obec = await makeObec('ends')
    await payload.create({
      collection: 'profiles',
      data: { user: resident.id, fullName: 'Obyvatel', municipality: obec.id } as never,
      overrideAccess: true,
    })
    await setObec(obec.id, { billingStatus: 'read_only' })
    await setObec(obec.id, { billingStatusChangedAt: new Date(Date.now() - (READ_ONLY_DAYS + 1) * DAY).toISOString() })

    const result = await advanceBillingStatuses(payload)
    expect(result.terminated).toBeGreaterThanOrEqual(1)
    expect((await readObec(obec.id))?.billingStatus).toBe('terminated')
    await vi.waitFor(async () => {
      expect(await noticesFor(admin, 'Smlouva obce s Lonvitou skončila')).toHaveLength(1)
      expect(await noticesFor(resident, `Obec Contract ends ${STAMP} končí s Lonvitou`)).toHaveLength(1)
    })

    await expect(
      payload.update({ collection: 'municipalities', id: obec.id, data: { description: 'x' }, ...as(admin) }),
    ).rejects.toThrow(/skončila/)
    // Its admin cannot bring it back.
    await payload.update({ collection: 'municipalities', id: obec.id, data: { billingStatus: 'active' } as never, ...as(platform) })
    expect((await readObec(obec.id))?.billingStatus).toBe('active')
  })

  it('its admin downloads all its data as a ZIP of CSVs; a resident may not', async () => {
    const obec = await makeObec('export')
    const event = await createEvent(obec.id, 5 * DAY, `Archivní akce ${STAMP}`)
    await payload.db.create({
      collection: 'registrations',
      data: { event: event.id, user: admin.id, status: 'approved', role: 'participant', attendanceStatus: 'not_marked' },
    })
    await setObec(obec.id, { billingStatus: 'terminated' })

    const request = { kind: 'municipality-archive' as const, format: 'zip' as const, params: { municipalityId: String(obec.id) } }
    expect(await canRequestExport(payload, admin, request)).toBe('allowed')
    expect(await canRequestExport(payload, resident, request)).toBe('forbidden')

    const { body } = await buildMunicipalityArchive(payload, String(obec.id))
    const files = unzip(body)
    expect([...files.keys()].sort()).toEqual(['README.txt', 'akce.csv', 'organizace.csv', 'prihlasky.csv', 'role.csv'])
    expect(files.get('akce.csv')).toContain(`Archivní akce ${STAMP}`)
    expect(files.get('prihlasky.csv')).toContain('"Admin Obce","účastník","schváleno"')
    expect(files.get('role.csv')).toContain('"Admin Obce","admin obce"')
    expect(files.get('prihlasky.csv')).not.toContain('@test.local')
  })

  it('a week before erasure, the events that would be later are cancelled — earlier ones take place', async () => {
    const obec = await makeObec('warn')
    await setObec(obec.id, { billingStatus: 'terminated' })
    // Erasure in 5 days.
    await setObec(obec.id, { billingStatusChangedAt: new Date(Date.now() - (TERMINATED_DAYS - 5) * DAY).toISOString(), billingWarnedAt: null })
    const before = await createEvent(obec.id, 2 * DAY)
    const after = await createEvent(obec.id, 10 * DAY)

    const result = await advanceBillingStatuses(payload)
    expect(result.eventsCancelled).toBeGreaterThanOrEqual(1)
    expect((await readEvent(after.id))?.status).toBe('cancelled')
    expect((await readEvent(before.id))?.status).toBe('active')
    await vi.waitFor(async () => expect(await noticesFor(admin, 'Údaje obce se za týden smažou')).toHaveLength(1))
  })

  it('after its period the obec is erased — everything of it goes (SMS, AI usage, exports too), its residents stay "bez obce", the erasure is on the record', async () => {
    const obec = await makeObec('erase')
    const person = await makeUser('erased-resident')
    const profile = await payload.create({
      collection: 'profiles',
      data: { user: person.id, fullName: 'Zůstávám', municipality: obec.id } as never,
      overrideAccess: true,
    })
    const past = await createEvent(obec.id, 2 * DAY)
    await payload.db.updateOne({ collection: 'events', id: past.id, data: { dateTime: new Date(Date.now() - 10 * DAY).toISOString() } })
    const ahead = await createEvent(obec.id, 20 * DAY)
    const sms = await payload.create({ collection: 'sms-messages', data: { municipality: obec.id, parts: 1 }, overrideAccess: true })
    const usage = (await payload.db.create({
      collection: 'usage-events',
      data: { municipality: obec.id, user: admin.id, provider: 'anthropic', model: 'test', operationType: 'event_import', source: 'worker', usageKind: 'tokens', status: 'success', inputTokens: 10, outputTokens: 5 },
    })) as { id: number }
    const exported = await payload.create({
      collection: 'exports',
      data: {
        owner: admin.id,
        kind: 'municipality-archive',
        format: 'zip',
        params: { municipalityId: String(obec.id) },
        status: 'done',
        expiresAt: new Date(Date.now() + 7 * DAY).toISOString(),
      },
      overrideAccess: true,
    })
    await setObec(obec.id, { billingStatus: 'terminated' })
    await setObec(obec.id, { billingStatusChangedAt: new Date(Date.now() - (TERMINATED_DAYS + 1) * DAY).toISOString() })
    await confirmErasure(obec.id)

    expect((await advanceBillingStatuses(payload)).erased).toBeGreaterThanOrEqual(1)
    // Nothing of it outlives it: no SMS or AI usage rows, its exports expired for the nightly cleanup.
    expect(await payload.findByID({ collection: 'sms-messages', id: sms.id, overrideAccess: true }).catch(() => null)).toBeNull()
    expect(await payload.findByID({ collection: 'usage-events', id: usage.id, overrideAccess: true }).catch(() => null)).toBeNull()
    const exp = await payload.findByID({ collection: 'exports', id: exported.id, overrideAccess: true })
    expect(new Date(exp.expiresAt!).getTime()).toBeLessThan(Date.now())
    await payload.delete({ collection: 'exports', id: exported.id, overrideAccess: true })
    expect(await readObec(obec.id)).toBeNull()
    expect(await readEvent(past.id)).toBeNull()
    expect(await readEvent(ahead.id)).toBeNull()
    const kept = await payload.findByID({ collection: 'profiles', id: profile.id, depth: 0, overrideAccess: true })
    expect(kept.municipality ?? null).toBeNull()
    const audit = await payload.find({
      collection: 'audit-log',
      where: { and: [{ action: { equals: 'municipalities.erase' } }, { targetId: { equals: String(obec.id) } }] },
      overrideAccess: true,
    })
    expect(audit.docs).toHaveLength(1)
  })

  it('an event about to start, too late to cancel, puts the erasure off until it has taken place', async () => {
    const obec = await makeObec('postpone')
    const soon = await createEvent(obec.id, 1 * HOUR)
    await setObec(obec.id, { billingStatus: 'terminated' })
    await setObec(obec.id, { billingStatusChangedAt: new Date(Date.now() - (TERMINATED_DAYS + 1) * DAY).toISOString() })
    await confirmErasure(obec.id)

    await advanceBillingStatuses(payload)
    expect((await readObec(obec.id))?.billingStatus).toBe('terminated')
    expect((await readEvent(soon.id))?.status).toBe('active')
  })
})
