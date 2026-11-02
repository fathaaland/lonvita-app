// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEmail: vi.fn(async () => undefined),
}))

import {
  describeChange,
  fingerprintOf,
  staleUrlOf,
  type EsbirkaVersion,
} from '@/lib/compliance/esbirka'
import { retentionFrom } from '@/lib/retention/settings'
import { RETENTION } from '@/lib/retention/policy'
import { DEFAULT_REQUIREMENTS } from '@/migrations/20261102_200114_compliance_register'

import { processComplianceCheckJob } from '../../worker/src/processors/compliance-check.processor'

let payload: Payload
const STAMP = Date.now()

const history = (
  versions: { staleUrl: string; typZneni: string; od: string; novely?: string[] }[],
) =>
  JSON.stringify({
    historie: versions.map((v) => ({
      staleUrl: v.staleUrl,
      typZneni: v.typZneni,
      datumUcinnostiZneniOd: v.od,
      novely: (v.novely ?? []).map((kodDokumentuSbirky) => ({ kodDokumentuSbirky })),
    })),
  })

const answering = (body: string, status = 200) =>
  vi.fn(
    async () => new Response(body, { status, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch

describe('Compliance — e-Sbírka watch, the register, retention and the audit log', () => {
  let admin: { id: number; email: string }
  let resident: { id: number; email: string }
  const created: number[] = []

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    admin = await payload.create({
      collection: 'users',
      data: { email: `compliance-root-${STAMP}@test.local`, password: 'test1234', role: 'admin' },
      overrideAccess: true,
    })
    resident = await payload.create({
      collection: 'users',
      data: { email: `compliance-user-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    // Only what these tests create is read from "e-Sbírka".
    await payload.update({
      collection: 'legal-requirements',
      where: { esbirkaWatch: { equals: true } },
      data: { esbirkaWatch: false },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    for (const id of created) {
      await payload
        .delete({ collection: 'legal-requirements', id, overrideAccess: true })
        .catch(() => {})
    }
    for (const id of [admin.id, resident.id]) {
      await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
    }
  })

  it('reads a regulation of the Sbírka zákonů, and tells a new or upcoming version in words', () => {
    expect(staleUrlOf('264/2025 Sb.')).toBe('/sb/2025/264')
    expect(staleUrlOf(' 89 / 2012 Sb ')).toBe('/sb/2012/89')
    expect(staleUrlOf('2016/679 (EU)')).toBeNull()

    const versions: EsbirkaVersion[] = [
      {
        staleUrl: '/sb/2012/89/2026-01-01',
        type: 'AKTUALNI',
        effectiveFrom: '2026-01-01',
        amendments: [],
      },
      {
        staleUrl: '/sb/2012/89/2027-01-01',
        type: 'BUDOUCI',
        effectiveFrom: '2027-01-01',
        amendments: ['159/2026 Sb.'],
      },
      {
        staleUrl: '/sb/2012/89/2025-07-01',
        type: 'MINULE',
        effectiveFrom: '2025-07-01',
        amendments: [],
      },
    ]
    // Past versions don't count, nor does their order.
    expect(fingerprintOf(versions)).toBe('/sb/2012/89/2026-01-01|/sb/2012/89/2027-01-01')
    expect(fingerprintOf([...versions].reverse())).toBe(fingerprintOf(versions))
    expect(describeChange('/sb/2012/89/2026-01-01', versions)).toBe(
      'Vyhlášena změna účinná od 1. 1. 2027 (novely: 159/2026 Sb.).',
    )
  })

  it('never keeps the audit log under its legal floor, whatever is stored', () => {
    expect(retentionFrom(null).auditLogMonths).toBe(RETENTION.auditLogMonths)
    expect(retentionFrom({ auditLogMonths: 6, auditExportMonths: 3 })).toMatchObject({
      auditLogMonths: 18,
      auditExportMonths: 18,
    })
    expect(retentionFrom({ auditLogMonths: 48, systemLogDays: 0 })).toMatchObject({
      auditLogMonths: 48,
      systemLogDays: 1,
    })
  })

  it('the default register is valid as it stands', async () => {
    for (const data of DEFAULT_REQUIREMENTS) {
      const doc = await payload.create({
        collection: 'legal-requirements',
        data: { ...data, code: `${data.code}-t${STAMP}`, esbirkaWatch: false },
        overrideAccess: true,
      })
      created.push(doc.id)
      expect(doc.status).toBe('review_needed')
    }
  })

  it('learns a watched regulation, then flags a change, tells the platform and writes it down', async () => {
    const req = await payload.create({
      collection: 'legal-requirements',
      data: {
        code: '99/2031 Sb.',
        title: `Test zákon ${STAMP}`,
        kind: 'zakon',
        status: 'ok',
        esbirkaWatch: true,
      },
      overrideAccess: true,
    })
    created.push(req.id)

    const now = new Date('2026-11-03T05:30:00Z')
    const first = await processComplianceCheckJob({
      now,
      paceMs: 0,
      fetchImpl: answering(
        history([{ staleUrl: '/sb/2031/99/2031-01-01', typZneni: 'AKTUALNI', od: '2031-01-01' }]),
      ),
    })
    expect(first.changed).toEqual([])
    const learned = await payload.findByID({
      collection: 'legal-requirements',
      id: req.id,
      overrideAccess: true,
    })
    expect(learned).toMatchObject({ status: 'ok', esbirkaFingerprint: '/sb/2031/99/2031-01-01' })

    const second = await processComplianceCheckJob({
      now,
      paceMs: 0,
      fetchImpl: answering(
        history([
          { staleUrl: '/sb/2031/99/2031-01-01', typZneni: 'AKTUALNI', od: '2031-01-01' },
          {
            staleUrl: '/sb/2031/99/2032-07-01',
            typZneni: 'BUDOUCI',
            od: '2032-07-01',
            novely: ['12/2032 Sb.'],
          },
        ]),
      ),
    })
    expect(second.changed).toEqual(['99/2031 Sb.'])
    const flagged = await payload.findByID({
      collection: 'legal-requirements',
      id: req.id,
      overrideAccess: true,
    })
    expect(flagged.status).toBe('changed')
    expect(flagged.esbirkaChangeSummary).toContain('účinná od 1. 7. 2032')

    const notice = await payload.find({
      collection: 'notifications',
      where: {
        and: [{ user: { equals: admin.id } }, { title: { equals: 'Změna předpisu v registru' } }],
      },
      overrideAccess: true,
    })
    expect(notice.docs[0]?.message).toContain('99/2031 Sb.')
    const entry = await payload.find({
      collection: 'audit-log',
      where: {
        and: [
          { action: { equals: 'legal-requirements.change-detected' } },
          { targetId: { equals: String(req.id) } },
        ],
      },
      overrideAccess: true,
    })
    expect(entry.totalDocs).toBe(1)

    // Reviewed: back to fine, the next review a year on, the change cleared.
    await payload.update({
      collection: 'legal-requirements',
      id: req.id,
      data: { lastReviewedAt: '2026-11-03T10:00:00.000Z' },
      user: admin,
      overrideAccess: false,
    })
    const reviewed = await payload.findByID({
      collection: 'legal-requirements',
      id: req.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(reviewed).toMatchObject({
      status: 'ok',
      esbirkaChangeSummary: null,
      lastReviewedBy: admin.id,
    })
    expect(new Date(reviewed.nextReviewAt!).getUTCFullYear()).toBe(2027)

    // e-Sbírka down: written on the regulation, nothing else changes.
    const failed = await processComplianceCheckJob({
      now,
      paceMs: 0,
      fetchImpl: answering('{}', 503),
    })
    expect(failed.failed).toEqual(['99/2031 Sb.'])
    const afterFailure = await payload.findByID({
      collection: 'legal-requirements',
      id: req.id,
      overrideAccess: true,
    })
    expect(afterFailure).toMatchObject({
      status: 'ok',
      esbirkaError: 'e-Sbírka vrátila chybu 503.',
    })

    await payload.update({
      collection: 'legal-requirements',
      id: req.id,
      data: { esbirkaWatch: false },
      overrideAccess: true,
    })
  })

  it('flags a review that came due', async () => {
    const req = await payload.create({
      collection: 'legal-requirements',
      data: {
        code: `GDPR-test-${STAMP}`,
        title: 'Test',
        kind: 'eu',
        esbirkaWatch: false,
        status: 'ok',
        reviewIntervalMonths: 1,
        lastReviewedAt: '2026-01-01T00:00:00.000Z',
      },
      overrideAccess: true,
    })
    created.push(req.id)
    const result = await processComplianceCheckJob({
      now: new Date('2026-11-03T05:30:00Z'),
      paceMs: 0,
      fetchImpl: answering('{}', 503),
    })
    expect(result.dueForReview).toContain(`GDPR-test-${STAMP}`)
    const due = await payload.findByID({
      collection: 'legal-requirements',
      id: req.id,
      overrideAccess: true,
    })
    expect(due.status).toBe('review_needed')
  })

  it("the register and the retention periods are the platform's alone", async () => {
    await expect(
      payload.find({ collection: 'legal-requirements', user: resident, overrideAccess: false }),
    ).rejects.toThrow()
    await expect(
      payload.updateGlobal({
        slug: 'retention-settings',
        data: { auditLogMonths: 24 },
        user: resident,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('serves the audit log to a platform admin only — and records that it was read', async () => {
    const { GET } = await import('@/app/api/superadmin/audit-log/route')
    const login = async (email: string) =>
      (await payload.login({ collection: 'users', data: { email, password: 'test1234' } })).token!
    const call = (token: string, query = '') =>
      GET(
        new Request(`http://localhost/api/superadmin/audit-log${query}`, {
          headers: { Authorization: `JWT ${token}` },
        }),
      )

    expect((await call(await login(resident.email))).status).toBe(403)

    const token = await login(admin.email)
    const res = await call(token, '?action=legal-requirements')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rows: { action: string }[] }
    expect(body.rows.length).toBeGreaterThan(0)
    expect(body.rows.every((r) => r.action.includes('legal-requirements'))).toBe(true)

    const csv = await call(token, '?action=legal-requirements&format=csv')
    expect(csv.headers.get('Content-Type')).toContain('text/csv')
    // The BOM Czech Excel needs (Response.text() would strip it — read the bytes).
    const bytes = new Uint8Array(await csv.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes).startsWith('Čas (UTC);Akce;')).toBe(true)

    await vi.waitFor(async () => {
      const reads = await payload.find({
        collection: 'audit-log',
        where: { and: [{ action: { equals: 'audit-log.read' } }, { actor: { equals: admin.id } }] },
        overrideAccess: true,
      })
      expect(reads.totalDocs).toBeGreaterThan(0)
    })
  })
})
