// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEmail: vi.fn(async () => undefined),
  enqueueSms: vi.fn(async () => undefined),
  enqueueImportEvents: vi.fn(async () => undefined),
}))

import { DELETE, GET, PATCH, POST } from '@/app/(payload)/api/[...slug]/route'
import { GET as packageUsage } from '@/app/api/municipalities/[id]/package-usage/route'
import { importOwnerFor } from '@/collections/access/import'
import { claimSmsParts } from '@/lib/billing/sms-ledger'
import { clearSmsReservations } from '@/lib/billing/sms-reservations'
import { IMPORT_LIMITS } from '@/lib/import/contracts'
import { recordUsageEvent } from '@/lib/usage/record-usage'
import { relationNumber } from '@/lib/relations'

let payload: Payload
const STAMP = Date.now()

type TestUser = { id: number; email: string; role: string }

/**
 * Organizers use the obec's SMS and import like its admins — through real HTTP (Payload's REST
 * handler with a JWT, so access control applies). What must still hold: each obec and its organizers
 * use only that obec's package (nothing reaches another obec, a mikroregion shares nothing), nobody
 * but the platform sets a limit, and nobody writes the ledgers of what was used.
 */
describe("Organizer import — one obec's package, nobody else's, and nobody writes the use", () => {
  let platform: TestUser
  let adminA: TestUser
  let adminB: TestUser
  let organizerA: TestUser
  let organizerA2: TestUser
  let organizerB: TestUser
  let obecA: { id: number }
  let obecB: { id: number }
  let cafeA: { id: number }
  let spolekA2: { id: number }
  let clubB: { id: number }
  const userIds: number[] = []
  const obecIds: number[] = []

  const makeUser = async (name: string, role: 'user' | 'admin' = 'user') => {
    const u = (await payload.create({
      collection: 'users',
      data: { email: `orgsec-${name}-${STAMP}@test.local`, password: 'test1234', role },
      overrideAccess: true,
    })) as TestUser
    userIds.push(u.id)
    return u
  }
  const tokenOf = async (u: TestUser) =>
    (await payload.login({ collection: 'users', data: { email: u.email, password: 'test1234' } })).token as string

  const call = async (
    handler: typeof GET,
    method: string,
    path: string,
    token: string | null,
    body?: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> }> => {
    const response = await handler(
      new Request(`http://localhost/api/${path}`, {
        method,
        headers: { ...(token ? { Authorization: `JWT ${token}` } : {}), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { params: Promise.resolve({ slug: path.split('?')[0].split('/') }) },
    )
    return { status: response.status, json: (await response.json().catch(() => ({}))) as Record<string, unknown> }
  }
  const refused = (status: number) => status >= 400 && status < 500

  const municipality = (name: string) =>
    payload.create({
      collection: 'municipalities',
      data: {
        name: `OrgSec ${name} ${STAMP}`,
        lat: 49.4,
        lng: 15.2,
        eventRadiusKm: 15,
        rulesForCreation: 'approved_organizers',
        smsEnabled: true,
        smsQuotaOverride: 50,
        importAiEnabled: true,
        scrapingMaxSourcesOverride: 20,
        licencePaidUntil: new Date(Date.now() + 200 * 86_400_000).toISOString(),
      } as never,
      overrideAccess: true,
    })
  const organizerIn = async (user: TestUser, obec: { id: number }, name: string) => {
    await payload.create({
      collection: 'profiles',
      data: { user: user.id, fullName: name, municipality: obec.id },
      overrideAccess: true,
    })
    return payload.create({
      collection: 'organizations',
      data: { name: `${name} ${STAMP}`, type: 'business', owner: user.id, municipality: obec.id },
      overrideAccess: true,
    })
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    platform = await makeUser('root', 'admin')
    adminA = await makeUser('admin-a')
    adminB = await makeUser('admin-b')
    organizerA = await makeUser('organizer-a')
    organizerA2 = await makeUser('organizer-a2')
    organizerB = await makeUser('organizer-b')
    obecA = await municipality('A')
    obecB = await municipality('B')
    obecIds.push(obecA.id, obecB.id)
    for (const [u, m] of [[adminA, obecA], [adminB, obecB]] as const) {
      await payload.create({ collection: 'user-roles', data: { user: u.id, municipality: m.id, role: 'municipality_admin' }, overrideAccess: true })
    }
    cafeA = await organizerIn(organizerA, obecA, 'Kavárna A')
    spolekA2 = await organizerIn(organizerA2, obecA, 'Spolek A2')
    clubB = await organizerIn(organizerB, obecB, 'Klub B')
  }, 120_000)

  afterAll(async () => {
    for (const id of obecIds) {
      await clearSmsReservations(id).catch(() => {})
      await payload.delete({ collection: 'sms-messages', where: { municipality: { equals: id } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'municipalities', id, overrideAccess: true }).catch(() => {})
    }
    for (const id of userIds) await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
  })

  const addSource = async (token: string, municipality: number, url: string, extra: Record<string, unknown> = {}) =>
    call(POST, 'POST', 'event-sources', token, { municipality, url, ownerConsent: true, ...extra })

  it("an organizer's source is theirs, in their own obec only — never another obec's, whatever the request says", async () => {
    const token = await tokenOf(organizerA)
    // Their own obec: created for their organization, whatever organization the request names.
    const own = await addSource(token, obecA.id, `https://a-${STAMP}.test/program`, { organization: clubB.id })
    expect(own.status).toBe(201)
    const doc = own.json.doc as { id: number; organization: unknown; municipality: unknown }
    expect(relationNumber(doc.organization)).toBe(cafeA.id)
    expect(relationNumber(doc.municipality)).toBe(obecA.id)

    // Another obec — even a neighbour in the same mikroregion — takes nothing from them.
    for (const [obec, extra] of [
      [obecB.id, {}],
      [obecB.id, { organization: cafeA.id }],
      [obecB.id, { organization: clubB.id }],
    ] as const) {
      const res = await addSource(token, obec, `https://b-${STAMP}-${Math.random()}.test/program`, extra)
      expect(refused(res.status), `source for obec B ${JSON.stringify(extra)}`).toBe(true)
    }
    expect(
      (await payload.count({ collection: 'event-sources', where: { municipality: { equals: obecB.id } }, overrideAccess: true })).totalDocs,
    ).toBe(0)

    // The same for the pasted-text and file imports and every read they cause: the owner is worked out
    // from the roles, per obec.
    expect(await importOwnerFor(payload, organizerA, obecA.id)).toEqual({ organization: cafeA.id })
    expect(await importOwnerFor(payload, organizerA, obecB.id)).toBeNull()
    expect(await importOwnerFor(payload, organizerB, obecA.id)).toBeNull()
    // Nor does an admin of one obec import for the other.
    expect(await importOwnerFor(payload, adminA, obecA.id)).toEqual({ organization: null })
    expect(await importOwnerFor(payload, adminA, obecB.id)).toBeNull()
  })

  it("an organizer can't move a source to another obec or owner, nor fake what the worker writes", async () => {
    const token = await tokenOf(organizerA)
    const created = await addSource(token, obecA.id, `https://forge-${STAMP}.test/`)
    const id = (created.json.doc as { id: number }).id
    const before = await payload.findByID({ collection: 'event-sources', id, depth: 0, overrideAccess: true })

    await call(PATCH, 'PATCH', `event-sources/${id}`, token, {
      municipality: obecB.id,
      organization: clubB.id,
      createdBy: adminA.id,
      url: 'https://evil.test/',
      lastRunAt: new Date(0).toISOString(),
      consecutiveFailures: 99,
      queuedAt: null,
      runningSince: new Date().toISOString(),
      lastContentHash: 'x',
      ownerConsentAt: new Date(0).toISOString(),
    })
    const after = await payload.findByID({ collection: 'event-sources', id, depth: 0, overrideAccess: true })
    for (const key of ['municipality', 'organization', 'createdBy', 'url', 'lastRunAt', 'consecutiveFailures', 'runningSince', 'lastContentHash', 'ownerConsentAt'] as const) {
      expect(after[key], key).toEqual(before[key])
    }
    // Several at once through a where — refused, each would be checked against the package alone.
    const bulk = await call(PATCH, 'PATCH', `event-sources?where[municipality][equals]=${obecA.id}`, token, { enabled: false })
    expect(bulk.status).toBeGreaterThanOrEqual(400)
  })

  it('each organizer sees and changes only their own sources, candidates and runs — the obec admin only the obec’s', async () => {
    const t1 = await tokenOf(organizerA)
    const t2 = await tokenOf(organizerA2)
    const tAdmin = await tokenOf(adminA)
    const mine = await addSource(t1, obecA.id, `https://mine-${STAMP}.test/`)
    const mineId = (mine.json.doc as { id: number }).id
    const theirs = await addSource(t2, obecA.id, `https://theirs-${STAMP}.test/`)
    expect(theirs.status).toBe(201)
    const obecs = await addSource(tAdmin, obecA.id, `https://obecs-${STAMP}.test/`)
    expect(obecs.status).toBe(201)
    const obecsId = (obecs.json.doc as { id: number }).id

    for (const [token, id, label] of [
      [t2, mineId, 'organizer 2 → organizer 1'],
      [tAdmin, mineId, 'obec admin → organizer'],
      [t1, obecsId, 'organizer → obec'],
      [await tokenOf(organizerB), mineId, 'other obec’s organizer'],
      [await tokenOf(adminB), mineId, 'other obec’s admin'],
    ] as const) {
      const got = await call(GET, 'GET', `event-sources/${id}`, token)
      expect(got.status, `read: ${label}`).toBeGreaterThanOrEqual(400)
      expect((await call(PATCH, 'PATCH', `event-sources/${id}`, token, { enabled: false })).status, `patch: ${label}`).toBeGreaterThanOrEqual(400)
      expect((await call(DELETE, 'DELETE', `event-sources/${id}`, token)).status, `delete: ${label}`).toBeGreaterThanOrEqual(400)
    }
    expect((await payload.findByID({ collection: 'event-sources', id: mineId, depth: 0, overrideAccess: true })).enabled).toBe(true)
    expect((await payload.findByID({ collection: 'event-sources', id: obecsId, depth: 0, overrideAccess: true })).enabled).toBe(true)

    // Their own list holds only their own.
    const list = await call(GET, 'GET', 'event-sources?limit=100', t1)
    const ids = (list.json.docs as { id: number }[]).map((d) => d.id)
    expect(ids).toContain(mineId)
    expect(ids).not.toContain(obecsId)
    expect(ids.length).toBe(
      (await payload.count({ collection: 'event-sources', where: { organization: { equals: cafeA.id } }, overrideAccess: true })).totalDocs,
    )
  })

  it('an obec that does not pay (read-only) takes no new source from an organizer — over REST too', async () => {
    const token = await tokenOf(organizerA)
    await payload.update({ collection: 'municipalities', id: obecA.id, data: { billingStatus: 'read_only' }, overrideAccess: true })
    try {
      const res = await addSource(token, obecA.id, `https://readonly-${STAMP}.test/`)
      expect(refused(res.status)).toBe(true)
    } finally {
      await payload.update({ collection: 'municipalities', id: obecA.id, data: { billingStatus: 'active' }, overrideAccess: true })
    }
  })

  it("one organizer can't fill the obec's ceiling of sources", async () => {
    const token = await tokenOf(organizerA2)
    let refusedAt = 0
    const have = (await payload.count({ collection: 'event-sources', where: { organization: { equals: spolekA2.id } }, overrideAccess: true })).totalDocs
    for (let i = have; i <= IMPORT_LIMITS.sourcesPerOrganization + 1; i++) {
      const res = await addSource(token, obecA.id, `https://strop-${STAMP}-${i}.test/`, { enabled: false })
      if (res.status >= 400) {
        refusedAt = i
        break
      }
    }
    expect(refusedAt).toBe(IMPORT_LIMITS.sourcesPerOrganization)
  })

  it("nobody but the platform changes an obec's SMS or import limits — not its admin, not its organizer, over REST", async () => {
    const limits = {
      smsEnabled: false,
      smsPackage: 'xl',
      smsQuotaOverride: 1_000_000,
      importAiEnabled: false,
      scrapingPackage: 'xl',
      scrapingMaxSourcesOverride: 1_000,
      scrapingMaxInputTokensOverride: 99_999_999,
      scrapingFrequency: 'twice_weekly',
      scrapingSlotDay: 3,
      billingStatus: 'terminated',
      licencePaidUntil: new Date(Date.now() + 9_000 * 86_400_000).toISOString(),
    }
    const read = () => payload.findByID({ collection: 'municipalities', id: obecA.id, depth: 0, overrideAccess: true })
    const before = await read()
    for (const who of [adminA, organizerA, adminB, organizerB]) {
      const res = await call(PATCH, 'PATCH', `municipalities/${obecA.id}`, await tokenOf(who), limits)
      expect(res.status).toBeLessThan(500)
      const after = await read()
      for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
        expect(after[key as keyof typeof after], `${key} by ${who.email}`).toEqual(before[key as keyof typeof before])
      }
    }
    // The platform, for contrast, may.
    const ok = await call(PATCH, 'PATCH', `municipalities/${obecA.id}`, await tokenOf(platform), { smsQuotaOverride: 60 })
    expect(ok.status).toBe(200)
    expect((await read()).smsQuotaOverride).toBe(60)
    await payload.update({ collection: 'municipalities', id: obecA.id, data: { smsQuotaOverride: 50 }, overrideAccess: true })
  })

  it("nobody writes what was used — the SMS and AI ledgers and the runs are the system's, read by the platform alone", async () => {
    await claimSmsParts(payload, { municipalityId: obecA.id, organizationId: cafeA.id, requestId: `event-cancelled-orgsec-${STAMP}-1`, parts: 1 })
    await recordUsageEvent(payload, {
      municipalityId: obecA.id,
      organizationId: cafeA.id,
      userId: organizerA.id,
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      operationType: 'event_import',
      source: 'worker',
      usage: { kind: 'tokens', inputTokens: 500, outputTokens: 50 },
    })
    const run = await payload.create({
      collection: 'import-runs',
      data: { municipality: obecA.id, organization: cafeA.id, trigger: 'text', status: 'success', startedAt: new Date().toISOString(), costUsd: 4.2, reviewNote: 'interní poznámka platformy', reviewStatus: 'problem' },
      overrideAccess: true,
    })
    const sms = await payload.find({ collection: 'sms-messages', where: { municipality: { equals: obecA.id } }, depth: 0, limit: 1, overrideAccess: true })
    const usage = await payload.find({ collection: 'usage-events', where: { municipality: { equals: obecA.id } }, depth: 0, limit: 1, overrideAccess: true })

    for (const who of [organizerA, adminA]) {
      const token = await tokenOf(who)
      for (const [collection, id] of [['sms-messages', sms.docs[0].id], ['usage-events', usage.docs[0].id], ['import-runs', run.id]] as const) {
        const label = `${who.email} ${collection}`
        expect(refused((await call(POST, 'POST', collection, token, { municipality: obecA.id, organization: cafeA.id })).status), `create ${label}`).toBe(true)
        expect(refused((await call(PATCH, 'PATCH', `${collection}/${id}`, token, { organization: spolekA2.id, parts: 0, costUsd: 0, aiCalls: 0 })).status), `patch ${label}`).toBe(true)
        expect(refused((await call(DELETE, 'DELETE', `${collection}/${id}`, token)).status), `delete ${label}`).toBe(true)
      }
      // The SMS and AI ledgers aren't even theirs to read.
      expect(refused((await call(GET, 'GET', 'sms-messages', token)).status)).toBe(true)
      expect(refused((await call(GET, 'GET', 'usage-events', token)).status)).toBe(true)
    }
    expect((await payload.findByID({ collection: 'sms-messages', id: sms.docs[0].id, depth: 0, overrideAccess: true })).parts).toBe(1)
    expect((await payload.findByID({ collection: 'import-runs', id: run.id, depth: 0, overrideAccess: true })).costUsd).toBe(4.2)

    // The organizer reads their own run — without what it cost us or what the platform noted on it.
    const own = await call(GET, 'GET', `import-runs/${run.id}`, await tokenOf(organizerA))
    expect(own.status).toBe(200)
    for (const key of ['costUsd', 'reviewNote', 'reviewStatus', 'reviewedBy']) expect(own.json, key).not.toHaveProperty(key)
    expect(own.json).toHaveProperty('aiCalls')
    // Another organizer of the same obec doesn't see the run at all.
    expect(refused((await call(GET, 'GET', `import-runs/${run.id}`, await tokenOf(organizerA2))).status)).toBe(true)
    const full = await call(GET, 'GET', `import-runs/${run.id}`, await tokenOf(platform))
    expect(full.json).toHaveProperty('reviewNote', 'interní poznámka platformy')
  })

  it("the use goes on the obec of the event or source — an organization of another obec is never kept on a ledger row", async () => {
    const claim = await claimSmsParts(payload, { municipalityId: obecA.id, organizationId: clubB.id, requestId: `event-cancelled-orgsec-${STAMP}-foreign`, parts: 1 })
    expect(claim.decision).toBe('send')
    const row = await payload.find({ collection: 'sms-messages', where: { requestId: { equals: `event-cancelled-orgsec-${STAMP}-foreign` } }, depth: 0, overrideAccess: true })
    expect(row.docs[0].organization ?? null).toBeNull()
    expect(relationNumber(row.docs[0].municipality)).toBe(obecA.id)

    await recordUsageEvent(payload, {
      municipalityId: obecA.id,
      organizationId: clubB.id,
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      operationType: 'event_import',
      source: 'worker',
      requestId: `orgsec-foreign-${STAMP}`,
      usage: { kind: 'tokens', inputTokens: 10, outputTokens: 1 },
    })
    const ai = await payload.find({ collection: 'usage-events', where: { requestId: { equals: `orgsec-foreign-${STAMP}` } }, depth: 0, overrideAccess: true })
    expect(ai.docs[0].organization ?? null).toBeNull()
  })

  it("only the obec's own admins read who used how much of its package — no organizer, no other obec", async () => {
    const ask = async (who: TestUser, obec: { id: number }) => {
      const spy = vi.spyOn(payload, 'auth').mockResolvedValueOnce({ user: { ...who, collection: 'users' } as never, permissions: {} as never } as never)
      const response = await packageUsage(new Request('http://localhost/api/x'), { params: Promise.resolve({ id: String(obec.id) }) })
      spy.mockRestore()
      return response.status
    }
    expect(await ask(adminA, obecA)).toBe(200)
    expect(await ask(platform, obecA)).toBe(200)
    expect(await ask(organizerA, obecA)).toBe(403)
    expect(await ask(organizerA2, obecA)).toBe(403)
    expect(await ask(adminB, obecA)).toBe(403)
    expect(await ask(organizerB, obecA)).toBe(403)
  })
})
