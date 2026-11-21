// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from 'vitest'

vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEmail: vi.fn(async () => undefined),
}))

import { enqueueEmail } from '@/lib/queue/queues'
import { sendNotification } from '@/collections/shared/notify'
import { categoriesVisibleTo, NOTIFICATION_CATEGORIES } from '@/lib/notifications/categories'

let payload: Payload
const STAMP = Date.now()

describe('E-mail notifications by circle — the app always gets everything', () => {
  const makeUser = async (name: string, profile: Record<string, unknown> = {}) => {
    const user = await payload.create({
      collection: 'users',
      data: { email: `notify-cat-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'profiles',
      data: { user: user.id, fullName: `Notify ${name}`, ...profile },
      overrideAccess: true,
    })
    return user
  }

  const send = (userId: number, category: 'my_events' | 'my_registrations' | 'obec_billing') =>
    sendNotification(payload, {
      userId,
      category,
      title: `t-${category}`,
      message: 'm',
      email: { subject: `s-${category}`, body: '<p>b</p>' },
    })

  const inApp = async (userId: number) =>
    (await payload.find({ collection: 'notifications', where: { user: { equals: userId } }, depth: 0, overrideAccess: true })).totalDocs

  beforeAll(async () => {
    payload = await getPayload({ config })
  })
  afterAll(async () => {
    await payload.destroy?.()
  })
  beforeEach(() => vi.mocked(enqueueEmail).mockClear())

  it('a circle switched off sends no e-mail, the others still do, the app gets both', async () => {
    const user = await makeUser('muted', { emailMuted: ['my_events'] })
    await send(user.id, 'my_events')
    await send(user.id, 'my_registrations')
    expect(vi.mocked(enqueueEmail).mock.calls.map(([job]) => job.subject)).toEqual(['s-my_registrations'])
    expect(await inApp(user.id)).toBe(2)
  })

  it('the app gets the notification even with the old in-app switch off or all e-mail off', async () => {
    const user = await makeUser('allmail', { notifyEmail: false, notifyInApp: false })
    await send(user.id, 'my_registrations')
    expect(enqueueEmail).not.toHaveBeenCalled()
    expect(await inApp(user.id)).toBe(1)
  })

  it('a locked circle cannot be switched off', async () => {
    const user = await makeUser('locked')
    const profile = (await payload.find({ collection: 'profiles', where: { user: { equals: user.id } }, overrideAccess: true })).docs[0]
    await expect(
      payload.update({ collection: 'profiles', id: profile.id, data: { emailMuted: ['obec_billing'] as never }, overrideAccess: true }),
    ).rejects.toThrow()
    await send(user.id, 'obec_billing')
    expect(enqueueEmail).toHaveBeenCalledTimes(1)
  })

  it('shows each person only the circles that concern them', () => {
    const keys = (a: { organizer: boolean; obecAdmin: boolean }) => categoriesVisibleTo(a).map((c) => c.key)
    expect(keys({ organizer: false, obecAdmin: false })).not.toContain('my_events')
    expect(keys({ organizer: false, obecAdmin: false })).not.toContain('obec_requests')
    expect(keys({ organizer: true, obecAdmin: false })).toContain('my_events')
    expect(keys({ organizer: true, obecAdmin: false })).not.toContain('obec_requests')
    expect(keys({ organizer: true, obecAdmin: true })).toContain('obec_requests')
    // What can't be switched off is never offered as a switch.
    for (const c of NOTIFICATION_CATEGORIES.filter((c) => c.locked)) {
      expect(keys({ organizer: true, obecAdmin: true })).not.toContain(c.key)
    }
  })
})
