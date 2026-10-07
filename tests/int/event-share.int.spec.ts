// @vitest-environment node
// Resvg (behind next/og) rejects jsdom's Uint8Array, which comes from another realm.
import { getPayload, Payload } from 'payload'
import sharp from 'sharp'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { GET as getShareImage } from '@/app/api/events/[id]/share-image/route'
import { generateMetadata } from '@/app/(frontend)/akce/[id]/page'
import { formatPragueEventWhen } from '@/lib/date'
import {
  buildEventShareCaption,
  buildFacebookEventDescription,
  eventDisplayLink,
  isEventShareable,
  isShareImageFormat,
  shareImageFileName,
  shareImageVersion,
  truncateText,
} from '@/lib/eventShare'

let payload: Payload

let municipality: { id: number }
let category: { id: number }
let organizer: { id: number }

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000
const eventIds: number[] = []

const createEvent = async (data: Record<string, unknown> = {}) => {
  const event = await payload.create({
    collection: 'events',
    data: {
      title: `Letní kino na návsi ${STAMP}`,
      description: 'Promítáme pod širým nebem.\nVezměte si deku.',
      dateTime: new Date(Date.now() + 3 * DAY).toISOString(),
      locationText: 'Náves, Nové Veselí',
      lat: 49.5661,
      lng: 15.9403,
      capacity: 30,
      organizer: organizer.id,
      municipality: municipality.id,
      categories: [category.id],
      status: 'active',
      isPaid: false,
      registrationApprovalMode: 'auto',
      ...data,
    },
    context: { skipNotifications: true },
    overrideAccess: true,
  })
  eventIds.push(event.id)
  return event
}

const shareImage = (id: number | string, query: string) =>
  getShareImage(new Request(`http://localhost/api/events/${id}/share-image?${query}`), {
    params: Promise.resolve({ id: String(id) }),
  })

const imageInfo = async (bytes: ArrayBuffer) => {
  const { format, width, height } = await sharp(Buffer.from(bytes)).metadata()
  return { format, width, height }
}

describe('Event share helpers', () => {
  it('formats the event time in Prague, whatever the server timezone', () => {
    expect(formatPragueEventWhen('2026-10-17T12:00:00.000Z')).toBe('sobota 17. října v 14:00')
    expect(formatPragueEventWhen('2026-12-05T17:30:00.000Z')).toBe('sobota 5. prosince v 18:30')
    // Late in the UTC evening is already the next day in Prague.
    expect(formatPragueEventWhen('2026-10-16T22:30:00.000Z')).toBe('sobota 17. října v 0:30')
    expect(formatPragueEventWhen('2026-10-17T12:00:00.000Z', '2026-10-17T15:30:00.000Z')).toBe(
      'sobota 17. října, 14:00–17:30',
    )
    expect(formatPragueEventWhen('2026-10-16T16:00:00.000Z', '2026-10-18T12:00:00.000Z')).toBe(
      'pátek 16. října 18:00 – neděle 18. října 14:00',
    )
  })

  it('builds the suggested post text with the link', () => {
    const caption = buildEventShareCaption(
      {
        title: 'Letní kino',
        description: 'Přijďte.',
        dateTime: '2026-10-17T12:00:00.000Z',
        locationText: 'Náves',
        isPaid: true,
        priceCents: 15000,
        isVolunteering: true,
      },
      'https://lonvita.cz/akce/5',
    )
    expect(caption).toContain('Letní kino')
    expect(caption).toContain('📅 sobota 17. října v 14:00')
    expect(caption).toContain('📍 Náves')
    expect(caption).toContain('Vstupné 150')
    expect(caption).toContain('Hledáme i dobrovolníky')
    expect(caption).toContain('Přihlaste se: https://lonvita.cz/akce/5')
  })

  it('prepares the description of a hand-made Facebook event, sign-up link included', () => {
    const description = buildFacebookEventDescription(
      {
        title: 'Letní kino',
        description: '  Přijďte.\nBude popcorn.  ',
        dateTime: '2026-10-17T12:00:00.000Z',
        locationText: 'Náves',
        isPaid: false,
      },
      'https://lonvita.cz/akce/5',
    )
    expect(description).toBe('Přijďte.\nBude popcorn.\n\n🎟️ Vstup zdarma\n\nPřihlaste se v aplikaci Lonvita: https://lonvita.cz/akce/5')
  })

  it('offers sharing only for an upcoming public event', () => {
    const future = new Date(Date.now() + DAY).toISOString()
    const past = new Date(Date.now() - DAY).toISOString()
    expect(isEventShareable({ status: 'active', dateTime: future })).toBe(true)
    expect(isEventShareable({ status: 'full', dateTime: future })).toBe(true)
    expect(isEventShareable({ status: 'active', isHidden: true, dateTime: future })).toBe(false)
    expect(isEventShareable({ status: 'cancelled', dateTime: future })).toBe(false)
    expect(isEventShareable({ status: 'active', dateTime: past })).toBe(false)
  })

  it('prints a short, typeable event address on the images', () => {
    expect(eventDisplayLink('https://www.lonvita.cz', 5)).toBe('lonvita.cz/akce/5')
    expect(eventDisplayLink('https://lonvita.cz/', '12')).toBe('lonvita.cz/akce/12')
    expect(eventDisplayLink('http://localhost:3000', 4)).toBe('localhost:3000/akce/4')
  })

  it('names files and checks formats safely', () => {
    expect(shareImageFileName('Letní kino: „Pelíšky“ na návsi!', 'post')).toBe('lonvita-letni-kino-pelisky-na-navsi-prispevek.jpg')
    expect(shareImageFileName('!!!', 'story')).toBe('lonvita-akce-pribeh.jpg')
    expect(isShareImageFormat('og')).toBe(true)
    expect(isShareImageFormat('toString')).toBe(false)
    expect(truncateText('Letní kino na návsi s promítáním pro celou rodinu', 20)).toBe('Letní kino na…')
  })
})

describe('Event share image and link preview', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    municipality = await payload.create({
      collection: 'municipalities',
      data: {
        name: `Test Muni Share ${STAMP}`,
        rulesForCreation: 'approved_organizers',
        lat: 49.5661,
        lng: 15.9403,
        eventRadiusKm: 15,
      },
      overrideAccess: true,
    })
    category = await payload.create({
      collection: 'event-categories',
      data: { name: `Test Category Share ${STAMP}` },
      overrideAccess: true,
    })
    organizer = await payload.create({
      collection: 'users',
      data: { email: `share-organizer-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'user-roles',
      data: { user: organizer.id, municipality: municipality.id, role: 'organizer' },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    for (const id of eventIds) {
      await payload.delete({ collection: 'events', id, overrideAccess: true }).catch(() => {})
    }
    await payload.delete({ collection: 'user-roles', where: { user: { equals: organizer.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'organizations', where: { owner: { equals: organizer.id } }, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'users', id: organizer.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'event-categories', id: category.id, overrideAccess: true }).catch(() => {})
    await payload.delete({ collection: 'municipalities', id: municipality.id, overrideAccess: true }).catch(() => {})
  })

  it('renders every format as a JPEG of its size — publicly, with no one signed in', async () => {
    const event = await createEvent()
    for (const [format, width, height] of [
      ['og', 1200, 630],
      ['post', 1080, 1350],
      ['story', 1080, 1920],
    ] as const) {
      const response = await shareImage(event.id, `format=${format}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('image/jpeg')
      expect(await imageInfo(await response.arrayBuffer())).toEqual({ format: 'jpeg', width, height })
    }
  }, 60_000)

  it('caches the current version for good and anything else only briefly', async () => {
    const event = await createEvent()
    const versioned = await shareImage(event.id, `format=og&v=${shareImageVersion(event.updatedAt)}`)
    expect(versioned.headers.get('Cache-Control')).toContain('immutable')
    const stale = await shareImage(event.id, 'format=og&v=1')
    expect(stale.headers.get('Cache-Control')).toContain('max-age=300')
  }, 60_000)

  it('refuses an unknown format and an event that does not exist', async () => {
    const event = await createEvent()
    expect((await shareImage(event.id, 'format=toString')).status).toBe(400)
    expect((await shareImage(999_999_999, 'format=og')).status).toBe(404)
    expect((await shareImage('abc', 'format=og')).status).toBe(404)
  })

  it('gives the event detail Open Graph tags pointing at the versioned preview image', async () => {
    const event = await createEvent()
    const metadata = await generateMetadata({ params: Promise.resolve({ id: String(event.id) }) })

    expect(metadata.title).toBe(`${event.title} · Lonvita`)
    expect(metadata.description).toContain('Náves, Nové Veselí')
    expect(metadata.description).not.toContain('\n')
    const images = metadata.openGraph?.images as { url: string; width: number; height: number }[]
    expect(images[0]).toMatchObject({
      url: `/api/events/${event.id}/share-image?format=og&v=${shareImageVersion(event.updatedAt)}`,
      width: 1200,
      height: 630,
    })
  })
})
