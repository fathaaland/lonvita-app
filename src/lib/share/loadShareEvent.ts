import path from 'node:path'

import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getPayload } from 'payload'
import { cache } from 'react'

import config from '@payload-config'
import type { EventShareInfo } from '@/lib/eventShare'
import { getS3Client, s3Bucket } from '@/lib/s3/client'

export type ShareEvent = EventShareInfo & {
  id: number
  status: 'active' | 'full' | 'finished' | 'cancelled'
  isHidden: boolean
  updatedAt: string
  /** Who runs it — the organization (or the obec itself), as on the event detail. */
  organizationName: string | null
  /** The cover photo's S3 key and the organizer's framing of it (object-position percentages). */
  image: { key: string; positionX: number; positionY: number } | null
}

/**
 * The event as a signed-out visitor may see it — which is what Facebook's crawler is, and what
 * anyone the link gets passed on to may be. Events' own read access applies (a deleted event is
 * gone); a related document it doesn't allow stays a bare id and is left out.
 */
export const loadShareEvent = cache(async (id: string): Promise<ShareEvent | null> => {
  if (!/^\d+$/.test(id)) return null
  const payload = await getPayload({ config })
  const event = await payload
    .findByID({ collection: 'events', id, depth: 1, overrideAccess: false, disableErrors: true })
    .catch(() => null)
  if (!event) return null

  const media = typeof event.image === 'object' ? event.image : null
  const organization = typeof event.organization === 'object' ? event.organization : null

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    dateTime: event.dateTime,
    endDateTime: event.endDateTime,
    locationText: event.locationText,
    isPaid: event.isPaid,
    priceCents: event.priceCents,
    isVolunteering: event.isVolunteering,
    status: event.status,
    isHidden: Boolean(event.isHidden),
    updatedAt: event.updatedAt,
    organizationName: organization?.name ?? null,
    image: media?.filename
      ? {
          // Where @payloadcms/storage-s3 puts an upload: the collection's prefix, then the file name.
          key: path.posix.join(media.prefix || 'media', media.filename),
          positionX: event.imagePositionX ?? 50,
          positionY: event.imagePositionY ?? 50,
        }
      : null,
  }
})

/** The cover photo's original bytes, straight from the bucket (no round trip through our own
 * /api/media/file route). Null when it's missing — the share image then goes without a photo. */
export async function readShareEventImage(key: string): Promise<Buffer | null> {
  try {
    const object = await getS3Client().send(new GetObjectCommand({ Bucket: s3Bucket(), Key: key }))
    const bytes = await object.Body?.transformToByteArray()
    return bytes ? Buffer.from(bytes) : null
  } catch {
    return null
  }
}
