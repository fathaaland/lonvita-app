import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'

vi.mock('@/lib/queue/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue/queues')>()),
  enqueueEmail: vi.fn(async () => undefined),
}))

import { enqueueEmail } from '@/lib/queue/queues'
import { digestEmail, REGISTRATION_DIGEST_WINDOW_MS, windowStartOf } from '@/lib/notifications/registration-digest'

import { processRegistrationDigestJob } from '../../worker/src/processors/registration-digest.processor'

let payload: Payload
const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000

describe('Registration digest — one e-mail per window to the team, not one per sign-up', () => {
  let municipality: { id: number }
  let organizer: { id: number; email: string }
  const participants: { id: number; email: string }[] = []
  let eventId: number

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    municipality = await payload.create({
      collection: 'municipalities',
      data: { name: `Digest Obec ${STAMP}`, rulesForCreation: 'approved_organizers', lat: 49.5661, lng: 15.9403, eventRadiusKm: 15 },
      overrideAccess: true,
    })
    const category = await payload.create({
      collection: 'event-categories',
      data: { name: `Digest Category ${STAMP}` },
      overrideAccess: true,
    })
    const createUser = async (name: string) => {
      const user = await payload.create({
        collection: 'users',
        data: { email: `digest-${name}-${STAMP}@test.local`, password: 'test1234', role: 'user' },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: `Digest ${name}`, municipality: municipality.id, onboardingCompleted: true },
        overrideAccess: true,
      })
      return user
    }
    organizer = await createUser('organizer')
    await payload.create({
      collection: 'user-roles',
      data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
      overrideAccess: true,
    })
    for (const name of ['a', 'b', 'c']) participants.push(await createUser(name))

    const event = await payload.create({
      collection: 'events',
      data: {
        title: `Digest event ${STAMP}`,
        dateTime: new Date(Date.now() + 7 * DAY).toISOString(),
        locationText: 'Test location',
        lat: 49.5661,
        lng: 15.9403,
        capacity: 10,
        organizer: organizer.id,
        municipality: municipality.id,
        categories: [category.id],
        status: 'active',
        isPaid: false,
        registrationApprovalMode: 'manual',
      },
      context: { skipNotifications: true },
      overrideAccess: true,
    })
    eventId = event.id
  })

  afterAll(async () => {
    await payload.delete({ collection: 'registrations', where: { event: { equals: eventId } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'events', id: eventId, overrideAccess: true }).catch(() => {})
  })

  it('reads one registration as before, several as a list with what waits for approval', () => {
    expect(digestEmail('Výlet', [{ registrationId: 1, who: 'Jana', awaiting: ' Přihláška čeká na vaše schválení.' }])).toEqual({
      subject: 'Nová přihláška: Výlet',
      body: '<p>Jana se přihlásil(a) na vaši akci <strong>Výlet</strong>. Přihláška čeká na vaše schválení.</p>',
    })
    const many = digestEmail('Výlet <b>', [
      { registrationId: 1, who: 'Jana', awaiting: 'x' },
      { registrationId: 2, who: 'Petr' },
      { registrationId: 3, who: 'Eva' },
    ])
    expect(many.subject).toBe('3 nové přihlášky: Výlet <b>')
    expect(many.body).toContain('přihlásili 3 lidé')
    expect(many.body).toContain('Výlet &lt;b&gt;')
    expect(many.body).toContain('1 z nich čeká na vaše schválení.')
  })

  it('sign-ups notify in-app at once, and the window sends the organizer one e-mail without those who left', async () => {
    vi.mocked(enqueueEmail).mockClear()
    const registrations = []
    for (const participant of participants) {
      registrations.push(
        await payload.create({
          collection: 'registrations',
          data: { event: eventId, user: participant.id, status: 'pending' },
          user: participant,
          overrideAccess: true,
        }),
      )
    }
    const windowEnd = windowStartOf(Date.now())

    // In-app per registration, right away.
    const inApp = await payload.find({
      collection: 'notifications',
      where: { and: [{ user: { equals: organizer.id } }, { title: { equals: 'Nová přihláška na akci' } }] },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    expect(inApp.totalDocs).toBe(3)
    // No organizer e-mail yet — only the participants' own confirmations.
    const toOrganizer = () => vi.mocked(enqueueEmail).mock.calls.filter(([data]) => data.to === organizer.email)
    expect(toOrganizer()).toHaveLength(0)

    // One of them changes their mind before the window closes.
    await payload.update({
      collection: 'registrations',
      id: registrations[2].id,
      data: { status: 'cancelled' },
      overrideAccess: true,
      context: { skipNotifications: true },
    })

    // The window the sign-ups fell in (and the one before, should the test have crossed its edge).
    const results = []
    for (const windowStart of [windowEnd - REGISTRATION_DIGEST_WINDOW_MS, windowEnd]) {
      results.push(await processRegistrationDigestJob({ eventId, windowStart }))
    }
    const mails = toOrganizer()
    expect(mails.length).toBeGreaterThanOrEqual(1)
    const bodies = mails.map(([data]) => data.body).join('\n')
    expect(bodies).toContain('Digest a')
    expect(bodies).toContain('Digest b')
    expect(bodies).not.toContain('Digest c')
    expect(results.reduce((n, r) => n + r.emails, 0)).toBe(mails.length)

    // A retry finds the window already sent.
    vi.mocked(enqueueEmail).mockClear()
    await processRegistrationDigestJob({ eventId, windowStart: windowEnd })
    expect(toOrganizer()).toHaveLength(0)
  })
})
