import type { Payload, PayloadRequest } from 'payload'

/**
 * Every field that may point at an upload. The nightly orphan purge (worker data-retention,
 * `orphaned-uploads`) keeps the same list, so a new upload field has to join both.
 */
const MEDIA_REFERENCES = [
  { collection: 'events', field: 'image' },
  { collection: 'profiles', field: 'avatar' },
  { collection: 'organizations', field: 'avatar' },
] as const

/**
 * Whether any event, profile or organization still shows this upload. The relationship fields
 * accept any media id, so "the avatar of the account being deleted" or "the cover of the event
 * being deleted" may well be somebody else's photo. Cleanup deletes only uploads nobody points at.
 */
export async function isMediaReferenced(
  payload: Payload,
  mediaId: number | string,
  req?: PayloadRequest,
): Promise<boolean> {
  for (const { collection, field } of MEDIA_REFERENCES) {
    const { totalDocs } = await payload.count({
      collection,
      where: { [field]: { equals: mediaId } },
      overrideAccess: true,
      req,
    })
    if (totalDocs > 0) return true
  }
  return false
}
