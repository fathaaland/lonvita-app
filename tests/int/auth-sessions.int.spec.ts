// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { GET as logout } from '@/app/(payload)/api/auth/logout/route'
import { buildPayloadTokenCookie } from '@/lib/auth/session-cookie'
import { endAllSessions } from '@/lib/auth/sessions'
import { licencePeriodOf } from '@/lib/billing/period'

let payload: Payload

const STAMP = Date.now()
const PASSWORD = 'session-test-1234'

const signIn = async (email: string) => {
  const result = await payload.login({ collection: 'users', data: { email, password: PASSWORD } })
  return result.token!
}

const userBehind = async (token: string) =>
  (await payload.auth({ headers: new Headers({ cookie: `payload-token=${token}` }) })).user

describe('Sign-in sessions (lib/auth/sessions, payload-token-jwt)', () => {
  let user: { id: number; email: string }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    user = (await payload.create({
      collection: 'users',
      data: { email: `sessions-${STAMP}@test.local`, password: PASSWORD, role: 'user' },
      overrideAccess: true,
    })) as typeof user
  })

  afterAll(async () => {
    await payload.delete({ collection: 'users', id: user.id, overrideAccess: true }).catch(() => {})
  })

  it('a token is good while its session lasts', async () => {
    const token = await signIn(user.email)
    expect((await userBehind(token))?.id).toBe(user.id)
  })

  it('signing out ends the session — a copy of the token taken before is no good', async () => {
    const token = await signIn(user.email)
    const other = await signIn(user.email)
    const response = await logout(new Request('http://localhost/api/auth/logout', { headers: { cookie: `payload-token=${token}` } }))
    expect(response.headers.get('set-cookie')).toMatch(/payload-token=;/)
    expect(await userBehind(token)).toBeNull()
    // Only that one — the same account signed in elsewhere stays.
    expect((await userBehind(other))?.id).toBe(user.id)
  })

  it('ending every session (a password reset) signs the account out everywhere', async () => {
    const one = await signIn(user.email)
    const two = await signIn(user.email)
    await endAllSessions(payload, user.id)
    expect(await userBehind(one)).toBeNull()
    expect(await userBehind(two)).toBeNull()
  })

  it('a Google sign-in opens a session of its own, ended by signing out too', async () => {
    const cookie = await buildPayloadTokenCookie(payload, user)
    const token = /payload-token=([^;]+)/.exec(cookie)![1]
    expect((await userBehind(token))?.id).toBe(user.id)
    await logout(new Request('http://localhost/api/auth/logout', { headers: { cookie: `payload-token=${token}` } }))
    expect(await userBehind(token)).toBeNull()
  })
})

describe('Unique indexes over find-then-create checks', () => {
  let municipality: { id: number }
  let user: { id: number }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Test Muni Unique ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    user = await payload.create({
      collection: 'users',
      data: { email: `unique-${STAMP}@test.local`, password: PASSWORD, role: 'user' },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await payload.delete({ collection: 'active-user-snapshots', where: { municipality: { equals: municipality.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', id: user.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true }).catch(() => {})
  })

  it('one snapshot per obec and month — a second one is refused by the database', async () => {
    const data = { municipality: municipality.id, month: '2026-11', activeUsers: 10, takenAt: new Date().toISOString() }
    await payload.db.create({ collection: 'active-user-snapshots', data })
    await expect(payload.db.create({ collection: 'active-user-snapshots', data: { ...data, activeUsers: 99 } })).rejects.toThrow()
  })

  it('one role per user and obec — a second one is refused by the database', async () => {
    const data = { user: user.id, municipality: municipality.id, role: 'municipality_admin' }
    await payload.db.create({ collection: 'user-roles', data })
    await expect(payload.db.create({ collection: 'user-roles', data })).rejects.toThrow()
  })
})

describe('Licence period', () => {
  it('an end on or before the start is refused', async () => {
    payload = await getPayload({ config: await config })
    await expect(
      payload.create({
        collection: 'municipalities',
        data: {
          name: `Test Muni Licence ${STAMP}`,
          rulesForCreation: 'approved_organizers',
          lat: 49.5661,
          lng: 15.9403,
          eventRadiusKm: 15,
          licencePeriodStart: '2026-06-01T00:00:00.000Z',
          licencePeriodEnd: '2026-01-01T00:00:00.000Z',
        },
        overrideAccess: true,
      }),
    ).rejects.toMatchObject({ data: { errors: [expect.objectContaining({ message: 'Konec licenčního období musí být po jeho začátku.' })] } })
  })

  it('one stored wrong before the check still counts as a year from its start', () => {
    const period = licencePeriodOf(
      { licencePeriodStart: '2026-06-01T00:00:00.000Z', licencePeriodEnd: '2026-01-01T00:00:00.000Z' },
      new Date('2026-08-01T00:00:00.000Z'),
    )
    expect(period.end.toISOString()).toBe('2027-06-01T00:00:00.000Z')
  })
})
