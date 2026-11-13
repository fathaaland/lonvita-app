// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { POST } from '@/app/api/auth/register/route'

let payload: Payload

const STAMP = Date.now()
const emailFor = (name: string) => `age-${name}-${STAMP}@test.local`

const register = (body: Record<string, unknown>) =>
  POST(
    new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

const validBody = (name: string) => ({
  email: emailFor(name),
  password: 'test1234',
  passwordConfirm: 'test1234',
  fullName: 'Věk Testovací',
  municipality: null,
  noMunicipality: true,
  consentAccepted: true,
  ageConfirmed: true,
})

describe('Registration asks for the "15+" declaration (/api/auth/register)', () => {
  const savedTurnstile = process.env.TURNSTILE_SECRET_KEY

  beforeAll(async () => {
    // Turnstile isn't what is tested here — off, as in local development.
    delete process.env.TURNSTILE_SECRET_KEY
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    if (savedTurnstile !== undefined) process.env.TURNSTILE_SECRET_KEY = savedTurnstile
    const users = await payload.find({
      collection: 'users',
      where: { email: { like: `-${STAMP}@test.local` } },
      limit: 10,
      depth: 0,
      overrideAccess: true,
    })
    for (const user of users.docs) {
      await payload.delete({ collection: 'consents', where: { user: { equals: user.id } }, overrideAccess: true })
      await payload.delete({ collection: 'profiles', where: { user: { equals: user.id } }, overrideAccess: true })
      await payload.delete({ collection: 'users', id: user.id, overrideAccess: true })
    }
  })

  const findUser = async (name: string) =>
    (
      await payload.find({
        collection: 'users',
        where: { email: { equals: emailFor(name) } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
    ).docs[0]

  it('refuses a registration without the declaration and creates no account', async () => {
    const { ageConfirmed: _omitted, ...body } = validBody('missing')
    const response = await register(body)
    expect(response.status).toBe(400)
    expect(await findUser('missing')).toBeUndefined()
  })

  it('refuses a declaration that is not literally true', async () => {
    const response = await register({ ...validBody('stringy'), ageConfirmed: 'true' })
    expect(response.status).toBe(400)
    expect(await findUser('stringy')).toBeUndefined()
  })

  it('records the declaration next to the terms consent', async () => {
    const response = await register(validBody('ok'))
    expect(response.status).toBe(201)

    const user = await findUser('ok')
    expect(user).toBeDefined()
    const consents = await payload.find({
      collection: 'consents',
      where: { user: { equals: user!.id } },
      depth: 0,
      overrideAccess: true,
    })
    const types = consents.docs.map((c) => c.type).sort()
    expect(types).toEqual(['age_15_plus', 'platform_terms'])
    const age = consents.docs.find((c) => c.type === 'age_15_plus')!
    expect(age.version).toBe('1.0')
    expect(age.revokedAt ?? null).toBeNull()
  })
})
