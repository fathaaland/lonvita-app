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

import { claimSmsParts } from '@/lib/billing/sms-ledger'
import { clearSmsReservations } from '@/lib/billing/sms-reservations'
import { getPackageUsage } from '@/lib/services/package-usage'
import { recordUsageEvent } from '@/lib/usage/record-usage'
import { ensureMunicipalityOrganization } from '@/collections/Organizations'
import { createLocalReq } from 'payload'
import { GET } from '@/app/api/municipalities/[id]/package-usage/route'

let payload: Payload
const STAMP = Date.now()

/**
 * Admins and approved organizers use the same SMS and import, all on the obec's packages — the obec
 * sees who used how much of them (lib/services/package-usage), and nobody else does.
 */
describe("Package usage — who of the obec used how much of its packages", () => {
  let obec: { id: number }
  let neighbour: { id: number }
  let admin: { id: number; email: string }
  let otherAdmin: { id: number; email: string }
  let organizer: { id: number }
  let neighbourOrganizer: { id: number }
  let cafe: { id: number }
  let neighbourClub: { id: number }
  let obecOrganization: number

  const user = (name: string) =>
    payload.create({
      collection: 'users',
      data: { email: `usage-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const municipality = (name: string) =>
      payload.create({
        collection: 'municipalities',
        data: {
          name: `Čerpání ${name} ${STAMP}`,
          lat: 49.4,
          lng: 15.2,
          eventRadiusKm: 15,
          rulesForCreation: 'approved_organizers',
          smsEnabled: true,
          smsQuotaOverride: 100,
          importAiEnabled: true,
        } as never,
        overrideAccess: true,
      })
    obec = await municipality('obec')
    neighbour = await municipality('soused')
    admin = await user('admin')
    otherAdmin = await user('other-admin')
    organizer = await user('organizer')
    neighbourOrganizer = await user('neighbour-organizer')
    for (const [u, m] of [
      [admin, obec],
      [otherAdmin, neighbour],
    ] as const) {
      await payload.create({
        collection: 'user-roles',
        data: { user: u.id, municipality: m.id, role: 'municipality_admin' },
        overrideAccess: true,
      })
    }
    await payload.create({
      collection: 'profiles',
      data: { user: organizer.id, fullName: 'Kavárník Čerpal', municipality: obec.id },
      overrideAccess: true,
    })
    cafe = await payload.create({
      collection: 'organizations',
      data: { name: `Kavárna ${STAMP}`, type: 'business', owner: organizer.id, municipality: obec.id },
      overrideAccess: true,
    })
    neighbourClub = await payload.create({
      collection: 'organizations',
      data: { name: `Sousední spolek ${STAMP}`, type: 'business', owner: neighbourOrganizer.id, municipality: neighbour.id },
      overrideAccess: true,
    })
    obecOrganization = Number(await ensureMunicipalityOrganization(await createLocalReq({}, payload), obec.id))

    // SMS of cancelled events — the café's (2 parts), the obec's own (1), one wrongly naming a
    // neighbour's club (1 — dropped, lib/billing/attribution), and one from before the ledger kept
    // whose it was (1).
    const sms = [
      { organizationId: cafe.id, parts: 1 },
      { organizationId: cafe.id, parts: 1 },
      { organizationId: obecOrganization, parts: 1 },
      { organizationId: neighbourClub.id, parts: 1 },
      { organizationId: null, parts: 1 },
    ]
    for (const [i, s] of sms.entries()) {
      const claim = await claimSmsParts(payload, {
        municipalityId: obec.id,
        organizationId: s.organizationId,
        requestId: `event-cancelled-usage-${STAMP}-${i}`,
        parts: s.parts,
      })
      expect(claim.decision).toBe('send')
    }
    // AI reads: three for the café, one for the obec's admins.
    const ai = (organizationId: number | null, userId: number) =>
      recordUsageEvent(payload, {
        municipalityId: obec.id,
        organizationId,
        userId,
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        operationType: 'event_import',
        source: 'worker',
        usage: { kind: 'tokens', inputTokens: 1000, outputTokens: 100 },
      })
    await ai(cafe.id, organizer.id)
    await ai(cafe.id, organizer.id)
    await ai(cafe.id, organizer.id)
    await ai(null, admin.id)
    // Sources: the café keeps one switched on, the obec one.
    await payload.create({
      collection: 'event-sources',
      data: { municipality: obec.id, organization: cafe.id, url: `https://kavarna-${STAMP}.test/` } as never,
      overrideAccess: true,
    })
    await payload.create({
      collection: 'event-sources',
      data: { municipality: obec.id, url: `https://obec-${STAMP}.test/` },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    for (const m of [obec, neighbour]) {
      await clearSmsReservations(m.id).catch(() => {})
      await payload.delete({ collection: 'sms-messages', where: { municipality: { equals: m.id } }, overrideAccess: true }).catch(() => {})
      await payload.delete({ collection: 'municipalities', id: m.id, overrideAccess: true }).catch(() => {})
    }
    for (const u of [admin, otherAdmin, organizer, neighbourOrganizer]) {
      await payload.delete({ collection: 'users', id: u.id, overrideAccess: true }).catch(() => {})
    }
  })

  it('each SMS on the ledger keeps whose event it was about', async () => {
    const rows = await payload.find({
      collection: 'sms-messages',
      where: { municipality: { equals: obec.id } },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    expect(rows.docs.filter((r) => Number(r.organization) === cafe.id)).toHaveLength(2)
  })

  it('splits the year’s use between the obec and each organizer — the obec’s own organization being the obec', async () => {
    const usage = await getPackageUsage(payload, obec.id, new Date())
    const byKind = (kind: string, organizationId?: number) =>
      usage.rows.find((r) => r.kind === kind && (organizationId === undefined || r.organizationId === organizationId))

    const obecRow = byKind('obec')!
    expect(obecRow).toMatchObject({ smsParts: 1, aiCalls: 1, enabledSources: 1 })

    const cafeRow = byKind('organization', cafe.id)!
    expect(cafeRow).toMatchObject({
      name: `Kavárna ${STAMP}`,
      ownerName: 'Kavárník Čerpal',
      smsParts: 2,
      aiCalls: 3,
      aiTokens: 3300,
      enabledSources: 1,
    })

    // An organization of another obec (a neighbour) is never kept on this obec's ledger — its SMS
    // counted as nobody's, and the neighbour's name appears nowhere in this obec's overview.
    expect(usage.rows.some((r) => r.organizationId === neighbourClub.id)).toBe(false)
    expect(usage.rows.some((r) => r.name.includes('Sousední'))).toBe(false)
    expect(byKind('unattributed')).toMatchObject({ smsParts: 2 })

    expect(usage.totals).toMatchObject({ smsParts: 5, aiCalls: 4, enabledSources: 2 })
    // The obec first, then the organizers by how much they used, the unattributed last.
    expect(usage.rows[0].kind).toBe('obec')
    expect(usage.rows[usage.rows.length - 1].kind).toBe('unattributed')
  })

  it("only the obec's admins and the platform's see it", async () => {
    const ask = async (who: { id: number; email: string } | null) => {
      const auth = vi.spyOn(payload, 'auth').mockResolvedValueOnce({
        user: who ? ({ ...who, role: 'user', collection: 'users' } as never) : null,
        permissions: {} as never,
      } as never)
      const response = await GET(new Request('http://test.local/api/municipalities/x/package-usage'), {
        params: Promise.resolve({ id: String(obec.id) }),
      })
      auth.mockRestore()
      return response.status
    }
    expect(await ask(admin)).toBe(200)
    expect(await ask(otherAdmin)).toBe(403)
    expect(await ask({ id: organizer.id, email: 'x' })).toBe(403)
    expect(await ask(null)).toBe(401)
  })
})
