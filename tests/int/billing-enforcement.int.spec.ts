// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueSms: vi.fn(async () => undefined),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueImportEvents: vi.fn(async () => undefined),
}))

import { enqueueImportEvents, enqueueSms } from '@/lib/queue/queues'
import { sendSmsToMany } from '@/collections/shared/notify'
import { smsUsageOf } from '@/lib/billing/sms'
import { sourcesWithinPackage } from '@/lib/billing/scraping'
import { claimSmsParts } from '@/lib/billing/sms-ledger'
import { clearSmsReservations, releaseSmsReservation, smsPartsHeld } from '@/lib/billing/sms-reservations'
import { processScanEventSourcesJob } from '../../worker/src/processors/scan-event-sources.processor'

let payload: Payload
const STAMP = Date.now()

/**
 * What an obec pays for is what it gets — no more. The obec's own admin, through the same access
 * control every REST and GraphQL request goes through (overrideAccess: false), can neither switch a
 * service on, raise a limit, nor wipe the record of what it used; and the SMS and scraping limits
 * hold where they are enforced (sendSmsToMany, the worker).
 */
describe('Billing enforcement — the obec gets what it pays for', () => {
  let obec: { id: number }
  let admin: { id: number; email: string; role: string }
  const userIds: number[] = []
  const smsRecipients: number[] = []

  const asAdmin = () => ({ user: { ...admin, collection: 'users' as const }, overrideAccess: false as const })

  const setObec = (data: Record<string, unknown>) =>
    payload.update({ collection: 'municipalities', id: obec.id, data, overrideAccess: true })

  const queuedSms = () =>
    vi.mocked(enqueueSms).mock.calls.map(([data]) => data as { requestId?: string; overage?: boolean })

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    obec = await payload.create({
      collection: 'municipalities',
      data: { name: `Enforcement obec ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers' },
      overrideAccess: true,
    })
    admin = (await payload.create({
      collection: 'users',
      data: { email: `enf-admin-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })) as typeof admin
    userIds.push(admin.id)
    await payload.create({
      collection: 'user-roles',
      data: { user: admin.id, municipality: obec.id, role: 'municipality_admin' },
      overrideAccess: true,
    })
    for (let i = 0; i < 6; i++) {
      const u = await payload.create({
        collection: 'users',
        data: { email: `enf-sms-${i}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      userIds.push(u.id)
      smsRecipients.push(u.id)
      await payload.create({
        collection: 'profiles',
        data: {
          user: u.id,
          fullName: `SMS ${i}`,
          phone: `+42077${String(STAMP).slice(-5)}${i}`,
          notifySms: true,
        } as never,
        overrideAccess: true,
      })
    }
  }, 120_000)

  afterAll(async () => {
    await payload.delete({ collection: 'event-sources', where: { municipality: { equals: obec.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'profiles', where: { user: { in: userIds } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: obec.id, overrideAccess: true }).catch(() => {})
    for (const id of userIds) await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
  })

  // ---------------------------------------------------------------------------------------------
  // Through the API: the obec admin tries to give itself what it hasn't paid for
  // ---------------------------------------------------------------------------------------------

  it('its admin cannot switch SMS or import on, lift a suspension, or raise any limit', async () => {
    await setObec({
      smsEnabled: false,
      importAiEnabled: false,
      billingStatus: 'suspended',
      smsPackage: 's',
      smsQuotaOverride: null,
      smsOverageAllowed: false,
      scrapingPackage: 's',
      scrapingMaxSourcesOverride: null,
      scrapingMaxInputTokensOverride: null,
      licencePeriodStart: null,
      licencePeriodEnd: null,
    })
    await payload.update({
      collection: 'municipalities',
      id: obec.id,
      data: {
        smsEnabled: true,
        importAiEnabled: true,
        billingStatus: 'active',
        smsPackage: 'l',
        smsQuotaOverride: 1_000_000,
        smsOverageAllowed: true,
        scrapingPackage: 'l',
        scrapingMaxSourcesOverride: 1000,
        scrapingMaxInputTokensOverride: 10_000_000,
        licencePeriodStart: '2020-01-01T00:00:00.000Z',
        licencePeriodEnd: '2020-01-02T00:00:00.000Z',
      } as never,
      ...asAdmin(),
    })
    const after = await payload.findByID({ collection: 'municipalities', id: obec.id, depth: 0, overrideAccess: true })
    expect(after.smsEnabled).toBe(false)
    expect(after.importAiEnabled).toBe(false)
    expect(after.billingStatus).toBe('suspended')
    expect(after.smsPackage).toBe('s')
    expect(after.smsQuotaOverride ?? null).toBeNull()
    expect(after.smsOverageAllowed).toBe(false)
    expect(after.scrapingPackage).toBe('s')
    expect(after.scrapingMaxSourcesOverride ?? null).toBeNull()
    expect(after.scrapingMaxInputTokensOverride ?? null).toBeNull()
    expect(after.licencePeriodStart ?? null).toBeNull()
    await setObec({ billingStatus: 'active' })
  })

  it('its admin cannot make itself a platform admin', async () => {
    await payload
      .update({ collection: 'users', id: admin.id, data: { role: 'admin' } as never, ...asAdmin() })
      .catch(() => null)
    const me = await payload.findByID({ collection: 'users', id: admin.id, overrideAccess: true })
    expect(me.role).toBe('user')
  })

  it('its admin can neither write nor wipe the record of what it used, nor touch the price list', async () => {
    const sms = await payload.create({
      collection: 'sms-messages',
      data: { municipality: obec.id, requestId: `enf-${STAMP}`, parts: 1 },
      overrideAccess: true,
    })
    await expect(
      payload.create({ collection: 'sms-messages', data: { municipality: obec.id, parts: 1 }, ...asAdmin() }),
    ).rejects.toThrow()
    await expect(payload.delete({ collection: 'sms-messages', id: sms.id, ...asAdmin() })).rejects.toThrow()
    await expect(payload.update({ collection: 'sms-messages', id: sms.id, data: { parts: 0 } as never, ...asAdmin() })).rejects.toThrow()
    // A bulk delete by query answers with no errors thrown but must delete nothing.
    await payload.delete({ collection: 'sms-messages', where: { municipality: { equals: obec.id } }, ...asAdmin() }).catch(() => null)
    expect((await payload.count({ collection: 'sms-messages', where: { id: { equals: sms.id } }, overrideAccess: true })).totalDocs).toBe(1)

    await payload.delete({ collection: 'usage-events', where: { municipality: { equals: obec.id } }, ...asAdmin() }).catch(() => null)
    await expect(
      payload.create({ collection: 'active-user-snapshots', data: { municipality: obec.id, month: '2020-01', activeUsers: 0 } as never, ...asAdmin() }),
    ).rejects.toThrow()
    await expect(payload.updateGlobal({ slug: 'billing-settings', data: { smsOveragePriceCzk: 0 } as never, ...asAdmin() })).rejects.toThrow()
    await expect(payload.findGlobal({ slug: 'billing-settings', ...asAdmin() })).rejects.toThrow()
    await expect(payload.find({ collection: 'sms-messages', ...asAdmin() })).rejects.toThrow()
  })

  // ---------------------------------------------------------------------------------------------
  // Scraping: the package caps the sources — however they're switched on
  // ---------------------------------------------------------------------------------------------

  it('a bulk switch-on cannot go past the package', async () => {
    await setObec({ importAiEnabled: true, billingStatus: 'active', scrapingMaxSourcesOverride: 2 })
    const ids: number[] = []
    for (let i = 0; i < 4; i++) {
      const s = await payload.create({
        collection: 'event-sources',
        data: { municipality: obec.id, url: `https://bulk-${STAMP}-${i}.cz/akce`, enabled: false },
        overrideAccess: true,
      })
      ids.push(s.id)
    }
    await payload
      .update({ collection: 'event-sources', where: { id: { in: ids } }, data: { enabled: true }, ...asAdmin() })
      .catch(() => null)
    const enabled = await payload.count({
      collection: 'event-sources',
      where: { and: [{ municipality: { equals: obec.id } }, { enabled: { equals: true } }] },
      overrideAccess: true,
    })
    expect(enabled.totalDocs).toBeLessThanOrEqual(2)
    await payload.delete({ collection: 'event-sources', where: { id: { in: ids } }, overrideAccess: true })
  })

  it('two sources added at the same moment cannot go past the package together', async () => {
    await setObec({ importAiEnabled: true, billingStatus: 'active', scrapingMaxSourcesOverride: 1 })
    await payload.delete({ collection: 'event-sources', where: { municipality: { equals: obec.id } }, overrideAccess: true })
    const results = await Promise.allSettled(
      [0, 1, 2, 3].map((i) =>
        payload.create({
          collection: 'event-sources',
          data: { municipality: obec.id, url: `https://race-${STAMP}-${i}.cz/akce`, ownerConsent: true } as never,
          ...asAdmin(),
        }),
      ),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    await payload.delete({ collection: 'event-sources', where: { municipality: { equals: obec.id } }, overrideAccess: true })
  })

  it('only the oldest sources up to the package are readable — none without scraping or when suspended', async () => {
    await setObec({ importAiEnabled: true, billingStatus: 'active', scrapingMaxSourcesOverride: 5 })
    const ids: number[] = []
    for (let i = 0; i < 4; i++) {
      const s = await payload.create({
        collection: 'event-sources',
        data: { municipality: obec.id, url: `https://covered-${STAMP}-${i}.cz/akce` },
        overrideAccess: true,
      })
      ids.push(s.id)
    }
    await setObec({ scrapingMaxSourcesOverride: 2 })
    expect([...(await sourcesWithinPackage(payload, obec.id))].sort((a, b) => a - b)).toEqual(ids.slice(0, 2))
    await setObec({ billingStatus: 'suspended' })
    expect((await sourcesWithinPackage(payload, obec.id)).size).toBe(0)
    await setObec({ billingStatus: 'active', importAiEnabled: false })
    expect((await sourcesWithinPackage(payload, obec.id)).size).toBe(0)
    await setObec({ importAiEnabled: true })
    await payload.delete({ collection: 'event-sources', where: { id: { in: ids } }, overrideAccess: true })
  })

  it('after a smaller package the worker reads no more sources than it allows', async () => {
    // Monday 2. 11. 2026, 9:30 in Prague — the obec's slot.
    const mondayNine = new Date('2026-11-02T08:30:00Z')
    await setObec({ importAiEnabled: true, billingStatus: 'active', scrapingSlotDay: 1, scrapingSlotHour: 9, scrapingMaxSourcesOverride: 5 })
    const ids: number[] = []
    for (let i = 0; i < 5; i++) {
      const s = await payload.create({
        collection: 'event-sources',
        data: { municipality: obec.id, url: `https://downgrade-${STAMP}-${i}.cz/akce` },
        overrideAccess: true,
      })
      ids.push(s.id)
    }
    // The platform moves the obec to a package of two sources; five are still switched on.
    await setObec({ scrapingMaxSourcesOverride: 2 })
    vi.mocked(enqueueImportEvents).mockClear()
    await processScanEventSourcesJob({}, mondayNine)
    const read = vi
      .mocked(enqueueImportEvents)
      .mock.calls.filter(([data]) => 'sourceId' in data && ids.includes(data.sourceId as number))
    expect(read.length).toBeLessThanOrEqual(2)
    await payload.delete({ collection: 'event-sources', where: { id: { in: ids } }, overrideAccess: true })
  })

  // ---------------------------------------------------------------------------------------------
  // SMS: who gets one is decided by the package, the quota and the suspension
  // ---------------------------------------------------------------------------------------------

  it('no SMS at all for an obec without the SMS package, or a suspended one', async () => {
    vi.mocked(enqueueSms).mockClear()
    await setObec({ smsEnabled: false, billingStatus: 'active' })
    expect((await sendSmsToMany(payload, obec.id, smsRecipients, 'Akce zrusena', `enf-off-${STAMP}`)).queued).toBe(0)
    await setObec({ smsEnabled: true, billingStatus: 'suspended', smsQuotaOverride: 1000 })
    expect((await sendSmsToMany(payload, obec.id, smsRecipients, 'Akce zrusena', `enf-susp-${STAMP}`)).queued).toBe(0)
    expect(queuedSms()).toHaveLength(0)
    await setObec({ billingStatus: 'active' })
  })

  it('an announcement started within the quota goes out whole, the excess marked as overage — then the next is blocked', async () => {
    await payload.delete({ collection: 'sms-messages', where: { municipality: { equals: obec.id } }, overrideAccess: true })
    await setObec({ smsEnabled: true, billingStatus: 'active', smsQuotaOverride: 3, smsOverageAllowed: false, licencePeriodStart: null, licencePeriodEnd: null })

    // 3 SMS left, 6 people: the cancellation goes to all six — three within the quota, three as overage.
    vi.mocked(enqueueSms).mockClear()
    expect((await sendSmsToMany(payload, obec.id, smsRecipients, 'Akce zrusena', `enf-q1-${STAMP}`)).queued).toBe(6)
    expect(queuedSms().filter((s) => s.overage)).toHaveLength(3)

    // They are queued, not sent yet — their reservation keeps a second announcement out.
    vi.mocked(enqueueSms).mockClear()
    expect((await sendSmsToMany(payload, obec.id, smsRecipients, 'Akce zmenena', `enf-q2-${STAMP}`)).queued).toBe(0)

    // With overage allowed, the next goes out too — every SMS past the quota marked as overage.
    await setObec({ smsOverageAllowed: true })
    vi.mocked(enqueueSms).mockClear()
    expect((await sendSmsToMany(payload, obec.id, smsRecipients, 'Akce zmenena', `enf-q3-${STAMP}`)).queued).toBe(6)
    expect(queuedSms().filter((s) => s.overage)).toHaveLength(6)
    await setObec({ smsOverageAllowed: false })
  })

  it('a long SMS uses up as many parts of the quota as it goes out in', async () => {
    const fresh = await payload.create({
      collection: 'municipalities',
      data: { name: `Enforcement parts ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers', smsEnabled: true, smsQuotaOverride: 5 } as never,
      overrideAccess: true,
    })
    try {
      vi.mocked(enqueueSms).mockClear()
      // 300 characters → two parts each: five parts of quota cover two people, the other four are overage.
      const long = 'x'.repeat(300)
      expect((await sendSmsToMany(payload, fresh.id, smsRecipients, long, `enf-long-${STAMP}`)).queued).toBe(6)
      expect(queuedSms().filter((s) => !s.overage)).toHaveLength(2)
    } finally {
      await payload.delete({ collection: 'municipalities', id: fresh.id, overrideAccess: true })
    }
  })

  it('two announcements at once: one is admitted whole, the other blocked', async () => {
    const fresh = await payload.create({
      collection: 'municipalities',
      data: { name: `Enforcement race ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers', smsEnabled: true, smsQuotaOverride: 4 } as never,
      overrideAccess: true,
    })
    try {
      vi.mocked(enqueueSms).mockClear()
      const [a, b] = await Promise.all([
        sendSmsToMany(payload, fresh.id, smsRecipients, 'Akce A zrusena', `enf-race-a-${STAMP}`),
        sendSmsToMany(payload, fresh.id, smsRecipients, 'Akce B zrusena', `enf-race-b-${STAMP}`),
      ])
      // One is admitted and goes to everyone; the other sees its parts held and is blocked.
      expect([a.queued, b.queued].sort()).toEqual([0, 6])
      expect(queuedSms().filter((s) => !s.overage)).toHaveLength(4)
    } finally {
      await payload.delete({ collection: 'municipalities', id: fresh.id, overrideAccess: true })
    }
  })

  it('an announcement that starts with any SMS left goes to everyone — the part past the quota is overage, then the obec is blocked', async () => {
    const fresh = await payload.create({
      collection: 'municipalities',
      data: { name: `Enforcement overshoot ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers', smsEnabled: true, smsQuotaOverride: 4, smsOverageAllowed: false } as never,
      overrideAccess: true,
    })
    try {
      vi.mocked(enqueueSms).mockClear()
      // 2 of 4 left, 6 people to text: all 6 go out, 4 of them past the quota.
      await payload.create({ collection: 'sms-messages', data: { municipality: fresh.id, parts: 2 }, overrideAccess: true })
      const first = await sendSmsToMany(payload, fresh.id, smsRecipients, 'Akce zrusena', `enf-over-${STAMP}`)
      expect(first).toEqual({ wanted: 6, queued: 6, withheld: 0 })
      expect(queuedSms().filter((s) => s.overage)).toHaveLength(4)

      // Their parts are held until sent, so the next announcement is already blocked …
      vi.mocked(enqueueSms).mockClear()
      expect((await sendSmsToMany(payload, fresh.id, smsRecipients, 'Akce zmenena', `enf-over2-${STAMP}`)).queued).toBe(0)
      // … and a reminder never goes past the quota.
      expect((await sendSmsToMany(payload, fresh.id, smsRecipients, 'Zitra akce', `enf-over3-${STAMP}`, { purpose: 'reminder' })).queued).toBe(0)

      // The worker's ledger takes the admitted ones as they come: within the quota first, the rest
      // recorded as overage — and never refused, whatever ran in between.
      await clearSmsReservations(fresh.id)
      const claims = []
      for (let i = 0; i < 4; i++) claims.push(await claimSmsParts(payload, { municipalityId: fresh.id, parts: 1 }))
      expect(claims.every((c) => c.decision === 'send')).toBe(true)
      expect(claims.filter((c) => c.decision === 'send' && c.overage)).toHaveLength(2)
      expect(await claimSmsParts(payload, { municipalityId: fresh.id, parts: 1, purpose: 'reminder' })).toEqual({
        decision: 'skip',
        reason: 'quota_used_up',
      })
      const usage = await smsUsageOf(payload, fresh.id, new Date())
      expect(usage.usedParts).toBe(6)
      expect(usage.overageParts).toBe(2)

      // Nothing left now: the next announcement is blocked outright.
      vi.mocked(enqueueSms).mockClear()
      expect((await sendSmsToMany(payload, fresh.id, smsRecipients, 'Akce zrusena', `enf-over4-${STAMP}`)).queued).toBe(0)
    } finally {
      await clearSmsReservations(fresh.id)
      await payload.delete({ collection: 'municipalities', id: fresh.id, overrideAccess: true })
    }
  })

  it('when the quota runs short, the first of the given order are texted, not a random few', async () => {
    const fresh = await payload.create({
      collection: 'municipalities',
      data: { name: `Enforcement order ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers', smsEnabled: true, smsQuotaOverride: 2 } as never,
      overrideAccess: true,
    })
    try {
      vi.mocked(enqueueSms).mockClear()
      const order = [...smsRecipients].reverse()
      await sendSmsToMany(payload, fresh.id, order, 'Akce zrusena', `enf-order-${STAMP}`)
      // Within the quota go the first two of the given order; the rest follow as overage.
      expect(queuedSms().filter((s) => !s.overage).map((s) => s.requestId)).toEqual(order.slice(0, 2).map((id) => `enf-order-${STAMP}-${id}`))
    } finally {
      await clearSmsReservations(fresh.id)
      await payload.delete({ collection: 'municipalities', id: fresh.id, overrideAccess: true })
    }
  })

  it('a reservation given back twice (a retried job) is taken off once', async () => {
    const fresh = await payload.create({
      collection: 'municipalities',
      data: { name: `Enforcement release ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers', smsEnabled: true, smsQuotaOverride: 2 } as never,
      overrideAccess: true,
    })
    try {
      await sendSmsToMany(payload, fresh.id, smsRecipients, 'Akce zrusena', `enf-rel-${STAMP}`)
      expect(await smsPartsHeld(fresh.id)).toBe(2)
      const first = `enf-rel-${STAMP}-${smsRecipients[0]}`
      await releaseSmsReservation(fresh.id, first, 1)
      await releaseSmsReservation(fresh.id, first, 1)
      expect(await smsPartsHeld(fresh.id)).toBe(1)
    } finally {
      await clearSmsReservations(fresh.id)
      await payload.delete({ collection: 'municipalities', id: fresh.id, overrideAccess: true })
    }
  })

  it('counts only the SMS of the current licence year', async () => {
    const fresh = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Enforcement period ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers',
        smsEnabled: true, smsQuotaOverride: 10,
        licencePeriodStart: '2026-07-01T00:00:00.000Z', licencePeriodEnd: '2027-07-01T00:00:00.000Z',
      } as never,
      overrideAccess: true,
    })
    try {
      const inPeriod = await payload.create({ collection: 'sms-messages', data: { municipality: fresh.id, parts: 2 }, overrideAccess: true })
      const before = await payload.create({ collection: 'sms-messages', data: { municipality: fresh.id, parts: 5 }, overrideAccess: true })
      await payload.db.drizzle.execute(
        `UPDATE sms_messages SET created_at = '2026-06-15T00:00:00Z' WHERE id = ${Number(before.id)}` as never,
      )
      const usage = await smsUsageOf(payload, fresh.id, new Date('2026-11-11T12:00:00Z'))
      expect(usage.usedParts).toBe(2)
      expect(usage.quota).toBe(10)
      void inPeriod
    } finally {
      await payload.delete({ collection: 'municipalities', id: fresh.id, overrideAccess: true })
    }
  })

  // ---------------------------------------------------------------------------------------------
  // The worker's last word (lib/billing/sms-ledger): the quota is a hard cap, the invoice exact
  // ---------------------------------------------------------------------------------------------

  it('the ledger counts exactly — twenty announcement SMS at once: five within the quota, fifteen overage, none lost', async () => {
    const fresh = await payload.create({
      collection: 'municipalities',
      data: { name: `Ledger cap ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers', smsEnabled: true, smsQuotaOverride: 5 } as never,
      overrideAccess: true,
    })
    try {
      const claims = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          claimSmsParts(payload, { municipalityId: fresh.id, requestId: `ledger-cap-${STAMP}-${i}`, parts: 1 }),
        ),
      )
      expect(claims.filter((c) => c.decision === 'send' && !c.overage)).toHaveLength(5)
      expect(claims.filter((c) => c.decision === 'send' && c.overage)).toHaveLength(15)
      const usage = await smsUsageOf(payload, fresh.id, new Date())
      expect([usage.usedParts, usage.overageParts]).toEqual([20, 15])

      // A reminder is turned away at the quota, never recorded.
      const reminders = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          claimSmsParts(payload, { municipalityId: fresh.id, requestId: `ledger-rem-${STAMP}-${i}`, parts: 1, purpose: 'reminder' }),
        ),
      )
      expect(reminders.every((c) => c.decision === 'skip' && c.reason === 'quota_used_up')).toBe(true)
    } finally {
      await payload.delete({ collection: 'municipalities', id: fresh.id, overrideAccess: true })
    }
  })

  it('with overage allowed every SMS past the quota is marked so — the invoice counts them exactly', async () => {
    const fresh = await payload.create({
      collection: 'municipalities',
      data: { name: `Ledger overage ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers', smsEnabled: true, smsQuotaOverride: 3, smsOverageAllowed: true } as never,
      overrideAccess: true,
    })
    try {
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          claimSmsParts(payload, { municipalityId: fresh.id, requestId: `ledger-over-${STAMP}-${i}`, parts: 1 }),
        ),
      )
      const usage = await smsUsageOf(payload, fresh.id, new Date())
      expect(usage.usedParts).toBe(10)
      expect(usage.overageParts).toBe(7)
    } finally {
      await payload.delete({ collection: 'municipalities', id: fresh.id, overrideAccess: true })
    }
  })

  it('a retry of the same SMS keeps its one row — and a suspended or unsubscribed obec gets none', async () => {
    const fresh = await payload.create({
      collection: 'municipalities',
      data: { name: `Ledger retry ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers', smsEnabled: true, smsQuotaOverride: 10 } as never,
      overrideAccess: true,
    })
    try {
      const first = await claimSmsParts(payload, { municipalityId: fresh.id, requestId: `ledger-retry-${STAMP}`, parts: 2 })
      const again = await claimSmsParts(payload, { municipalityId: fresh.id, requestId: `ledger-retry-${STAMP}`, parts: 2 })
      expect(first.decision === 'send' && again.decision === 'send' && first.rowId === again.rowId).toBe(true)
      expect((await smsUsageOf(payload, fresh.id, new Date())).usedParts).toBe(2)

      await payload.update({ collection: 'municipalities', id: fresh.id, data: { billingStatus: 'suspended' }, overrideAccess: true })
      expect(await claimSmsParts(payload, { municipalityId: fresh.id, requestId: `ledger-s-${STAMP}`, parts: 1 })).toEqual({ decision: 'skip', reason: 'suspended' })
      await payload.update({ collection: 'municipalities', id: fresh.id, data: { billingStatus: 'active', smsEnabled: false }, overrideAccess: true })
      expect(await claimSmsParts(payload, { municipalityId: fresh.id, requestId: `ledger-n-${STAMP}`, parts: 1 })).toEqual({ decision: 'skip', reason: 'no_sms' })
    } finally {
      await payload.delete({ collection: 'municipalities', id: fresh.id, overrideAccess: true })
    }
  })
})
