import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

// "Označit vše jako přečtené" — one bulk update scoped by the user's own update access, so it
// reaches unread notifications past the 100 the page lists, and never anyone else's.

let payload: Payload

const STAMP = Date.now()

type TestUser = { id: number; email: string; role: string }

describe('Marking every notification read', () => {
  let owner: TestUser
  let other: TestUser

  const notify = (user: TestUser, title: string) =>
    payload.create({
      collection: 'notifications',
      data: { user: user.id, title, message: title },
      overrideAccess: true,
    })

  const unreadOf = async (user: TestUser) =>
    (
      await payload.count({
        collection: 'notifications',
        where: { user: { equals: user.id }, readAt: { exists: false } },
        overrideAccess: true,
      })
    ).totalDocs

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const makeUser = (name: string) =>
      payload.create({
        collection: 'users',
        data: { email: `mark-all-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      }) as Promise<TestUser>
    owner = await makeUser('owner')
    other = await makeUser('other')
  })

  afterAll(async () => {
    for (const user of [owner, other]) {
      if (!user) continue
      await payload.delete({ collection: 'notifications', where: { user: { equals: user.id } }, overrideAccess: true })
      await payload.delete({ collection: 'users', id: user.id, overrideAccess: true })
    }
  })

  it('clears all of the unread — more than the page shows', async () => {
    for (let i = 0; i < 105; i++) await notify(owner, `Owner ${i}`)
    await notify(other, 'Other')

    await payload.update({
      collection: 'notifications',
      where: { user: { equals: owner.id }, readAt: { exists: false } },
      data: { readAt: new Date().toISOString() },
      user: owner,
      overrideAccess: false,
    })

    expect(await unreadOf(owner)).toBe(0)
    expect(await unreadOf(other)).toBe(1)
  })

  it("can't reach someone else's notifications by asking for them", async () => {
    await payload.update({
      collection: 'notifications',
      where: { user: { equals: other.id } },
      data: { readAt: new Date().toISOString() },
      user: owner,
      overrideAccess: false,
    })

    expect(await unreadOf(other)).toBe(1)
  })
})
