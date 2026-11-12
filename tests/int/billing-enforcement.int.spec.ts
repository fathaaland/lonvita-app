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
import { sendCancellationSms } from '@/collections/shared/notify'
import { cancellationSmsText, smsUsageOf } from '@/lib/billing/sms'
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
 * hold where they are enforced (sendCancellationSms, the worker).
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
  // SMS: only a cancellation, decided by the package, the quota and the suspension
  // ---------------------------------------------------------------------------------------------

  const cancel = (municipalityId: number, users: number[], name: string, title = 'Ples') =>
    sendCancellationSms(payload, municipalityId, users, title, `event-cancelled-${name}-${STAMP}`)

  const freshObec = (name: string, data: Record<string, unknown>) =>
    payload.create({
      collection: 'municipalities',
      data: { name: `Enforcement ${name} ${STAMP}`, lat: 49.4, lng: 15.2, eventRadiusKm: 15, rulesForCreation: 'approved_organizers', smsEnabled: true, ...data } as never,
      overrideAccess: true,
    })

  const dropObec = async (id: number) => {
    await clearSmsReservations(id)
    await payload.delete({ collection: 'municipalities', id, overrideAccess: true })
  }

  it('no SMS at all for an obec without the SMS package, or a suspended one', async () => {
    vi.mocked(enqueueSms).mockClear()
    await setObec({ smsEnabled: false, billingStatus: 'active' })
    expect((await cancel(obec.id, smsRecipients, 'off')).queued).toBe(0)
    await setObec({ smsEnabled: true, billingStatus: 'suspended', smsQuotaOverride: 1000 })
    expect((await cancel(obec.id, smsRecipients, 'susp')).queued).toBe(0)
    expect(queuedSms()).toHaveLength(0)
    await setObec({ billingStatus: 'active' })
  })

  it('sends nothing but a cancellation — no other announcement id gets through', async () => {
    vi.mocked(enqueueSms).mockClear()
    const outcome = await sendCancellationSms(payload, obec.id, smsRecipients, 'Ples', `event-updated-x-${STAMP}`)
    expect(outcome.queued).toBe(0)
    expect(queuedSms()).toHaveLength(0)
  })

  it('the text is one part without links, however the pořadatel named the event', () => {
    const text = cancellationSmsText(`Ples https://phish.example/x a www.zly.cz nebo zly.cz/login ${'dlouhy nazev '.repeat(30)}`)
    expect(text.length).toBeLessThanOrEqual(160)
    expect(text).toMatch(/^Lonvita: akce ".*" byla zrusena\.$/)
    expect(text).not.toMatch(/https?:|www\.|zly\.cz|phish/)
    expect(cancellationSmsText('Žluťoučký kůň')).toBe('Lonvita: akce "Zlutoucky kun" byla zrusena.')
  })

  it('a cancellation started within the quota goes out whole, the excess marked as overage — then the next is blocked', async () => {
    const fresh = await freshObec('whole', { smsQuotaOverride: 3 })
    try {
      // 3 SMS left, 6 people: the cancellation goes to all six — three within the quota, three as overage.
      vi.mocked(enqueueSms).mockClear()
      expect(await cancel(fresh.id, smsRecipients, 'q1')).toEqual({ wanted: 6, queued: 6, withheld: 0 })
      expect(queuedSms().every((s) => !s.overage)).toBe(true) // decided by the ledger, not the job
      // They are queued, not sent yet — their reservation keeps a second cancellation out.
      vi.mocked(enqueueSms).mockClear()
      expect(await cancel(fresh.id, smsRecipients, 'q2')).toEqual({ wanted: 6, queued: 0, withheld: 6 })
    } finally {
      await dropObec(fresh.id)
    }
  })

  it('two cancellations at once: one is admitted whole, the other blocked', async () => {
    const fresh = await freshObec('race', { smsQuotaOverride: 4 })
    try {
      const [a, b] = await Promise.all([cancel(fresh.id, smsRecipients, 'race-a'), cancel(fresh.id, smsRecipients, 'race-b')])
      expect([a.queued, b.queued].sort()).toEqual([0, 6])
    } finally {
      await dropObec(fresh.id)
    }
  })

  it('texts in the order given — the callers pass approved first, then by sign-up', async () => {
    const fresh = await freshObec('order', { smsQuotaOverride: 2 })
    try {
      vi.mocked(enqueueSms).mockClear()
      const order = [...smsRecipients].reverse()
      await cancel(fresh.id, order, 'order')
      expect(queuedSms().map((s) => s.requestId)).toEqual(order.map((id) => `event-cancelled-order-${STAMP}-${id}`))
    } finally {
      await dropObec(fresh.id)
    }
  })

  it('a retried cancellation texts nobody twice and holds no quota for those already texted', async () => {
    const fresh = await freshObec('retry', { smsQuotaOverride: 10 })
    try {
      const prefix = `event-cancelled-retry-${STAMP}`
      await cancel(fresh.id, smsRecipients, 'retry')
      // Two of them already went out (on the ledger) when the job ran again after a crash.
      for (const id of smsRecipients.slice(0, 2)) {
        await claimSmsParts(payload, { municipalityId: fresh.id, requestId: `${prefix}-${id}`, parts: 1 })
        await releaseSmsReservation(fresh.id, `${prefix}-${id}`, 1)
      }
      vi.mocked(enqueueSms).mockClear()
      expect(await cancel(fresh.id, smsRecipients, 'retry')).toEqual({ wanted: 6, queued: 4, withheld: 0 })
      expect(queuedSms().map((s) => s.requestId)).not.toContain(`${prefix}-${smsRecipients[0]}`)
      expect(await smsPartsHeld(fresh.id)).toBe(4)
    } finally {
      await dropObec(fresh.id)
    }
  })

  it('a reservation given back twice (a retried job) is taken off once', async () => {
    const fresh = await freshObec('release', { smsQuotaOverride: 2 })
    try {
      await cancel(fresh.id, smsRecipients.slice(0, 2), 'rel')
      expect(await smsPartsHeld(fresh.id)).toBe(2)
      const first = `event-cancelled-rel-${STAMP}-${smsRecipients[0]}`
      await releaseSmsReservation(fresh.id, first, 1)
      await releaseSmsReservation(fresh.id, first, 1)
      expect(await smsPartsHeld(fresh.id)).toBe(1)
    } finally {
      await dropObec(fresh.id)
    }
  })

  // ---------------------------------------------------------------------------------------------
  // The worker's last word (lib/billing/sms-ledger): exact, and holding without Redis
  // ---------------------------------------------------------------------------------------------

  it('the ledger takes only a cancellation', async () => {
    const fresh = await freshObec('ledger-only', { smsQuotaOverride: 10 })
    try {
      for (const requestId of [undefined, `event-updated-1-${STAMP}-5`, `reminder-1-${STAMP}-5`]) {
        expect(await claimSmsParts(payload, { municipalityId: fresh.id, requestId, parts: 1 })).toEqual({
          decision: 'skip',
          reason: 'not_cancellation',
        })
      }
    } finally {
      await dropObec(fresh.id)
    }
  })

  it('one cancellation at once goes out whole past the quota — counted exactly, none lost', async () => {
    const fresh = await freshObec('ledger-whole', { smsQuotaOverride: 5 })
    try {
      const claims = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          claimSmsParts(payload, { municipalityId: fresh.id, requestId: `event-cancelled-lw-${STAMP}-${i}`, parts: 1 }),
        ),
      )
      expect(claims.filter((c) => c.decision === 'send' && !c.overage)).toHaveLength(5)
      expect(claims.filter((c) => c.decision === 'send' && c.overage)).toHaveLength(15)
      const usage = await smsUsageOf(payload, fresh.id, new Date())
      expect([usage.usedParts, usage.overageParts]).toEqual([20, 15])
      // The next cancellation started with nothing left — refused, never recorded.
      expect(await claimSmsParts(payload, { municipalityId: fresh.id, requestId: `event-cancelled-lw2-${STAMP}-1`, parts: 1 })).toEqual({
        decision: 'skip',
        reason: 'quota_used_up',
      })
    } finally {
      await dropObec(fresh.id)
    }
  })

  it('two cancellations decided at once by the ledger alone (no Redis): only one gets past the quota', async () => {
    const fresh = await freshObec('ledger-two', { smsQuotaOverride: 1 })
    try {
      const claims = await Promise.all(
        ['a', 'b'].flatMap((x) =>
          [1, 2, 3].map((i) => claimSmsParts(payload, { municipalityId: fresh.id, requestId: `event-cancelled-l2${x}-${STAMP}-${i}`, parts: 1 })),
        ),
      )
      const sentA = claims.slice(0, 3).filter((c) => c.decision === 'send').length
      const sentB = claims.slice(3).filter((c) => c.decision === 'send').length
      // Whichever came first goes to all three; the other started with the quota used up — refused whole.
      expect([sentA, sentB].filter((n) => n > 0)).toHaveLength(1)
      expect(sentA + sentB).toBe(3)
    } finally {
      await dropObec(fresh.id)
    }
  })

  it('a retry of the same SMS keeps its one row — and a suspended or unsubscribed obec gets none', async () => {
    const fresh = await freshObec('ledger-retry', { smsQuotaOverride: 10 })
    try {
      const id = `event-cancelled-lr-${STAMP}-1`
      const first = await claimSmsParts(payload, { municipalityId: fresh.id, requestId: id, parts: 2 })
      const again = await claimSmsParts(payload, { municipalityId: fresh.id, requestId: id, parts: 2 })
      expect(first.decision === 'send' && again.decision === 'send' && first.rowId === again.rowId).toBe(true)
      expect((await smsUsageOf(payload, fresh.id, new Date())).usedParts).toBe(2)

      await payload.update({ collection: 'municipalities', id: fresh.id, data: { billingStatus: 'suspended' }, overrideAccess: true })
      expect(await claimSmsParts(payload, { municipalityId: fresh.id, requestId: `event-cancelled-ls-${STAMP}-1`, parts: 1 })).toEqual({ decision: 'skip', reason: 'suspended' })
      await payload.update({ collection: 'municipalities', id: fresh.id, data: { billingStatus: 'active', smsEnabled: false }, overrideAccess: true })
      expect(await claimSmsParts(payload, { municipalityId: fresh.id, requestId: `event-cancelled-ln-${STAMP}-1`, parts: 1 })).toEqual({ decision: 'skip', reason: 'no_sms' })
    } finally {
      await dropObec(fresh.id)
    }
  })
})
