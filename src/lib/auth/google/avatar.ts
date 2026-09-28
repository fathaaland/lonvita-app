import type { Payload } from 'payload'

import { logger, serializeError } from '@/lib/logger'

import type { GoogleProfile } from './provider'

/** Same formats Media accepts — anything else would be refused by the upload anyway. */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_BYTES = 5 * 1024 * 1024
/** Big enough for the 320px avatar crop on a retina screen; Google defaults to 96px. */
const REQUESTED_SIZE = 640

/** Google serves profile photos from googleusercontent.com only. The URL comes from Google's
 * own userinfo response, but the server fetching it is ours — so nothing else gets fetched. */
export function googlePhotoUrl(pictureUrl: string): string | null {
  let url: URL
  try {
    url = new URL(pictureUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.googleusercontent.com')) return null
  // Size lives in a trailing "=s96-c" option; without one Google serves its default size.
  url.pathname = url.pathname.replace(/=s\d+(-c)?$/, '') + `=s${REQUESTED_SIZE}-c`
  return url.toString()
}

/**
 * Brings the Google photo over as the profile's avatar — once per Google identity. After that
 * the photo belongs to the person: replacing or removing it in Lonvita sticks, and a later
 * sign-in doesn't put Google's back. Never fails the sign-in; a missing photo just means
 * initials.
 */
export async function importGoogleAvatar(
  payload: Payload,
  identityId: number,
  userId: number,
  profile: GoogleProfile,
): Promise<void> {
  try {
    const profiles = await payload.find({
      collection: 'profiles',
      where: { user: { equals: userId } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
    })
    const target = profiles.docs[0]
    const source = profile.pictureUrl ? googlePhotoUrl(profile.pictureUrl) : null

    if (target && !target.avatar && source) {
      const response = await fetch(source, { signal: AbortSignal.timeout(5000) })
      const contentType = response.headers.get('content-type')?.split(';')[0].trim() ?? ''
      if (!response.ok || !ACCEPTED_TYPES.includes(contentType)) {
        throw new Error(`Google photo returned ${response.status} ${contentType}`)
      }
      const data = Buffer.from(await response.arrayBuffer())
      if (data.byteLength > MAX_BYTES) throw new Error(`Google photo is ${data.byteLength} bytes`)

      const media = await payload.create({
        collection: 'media',
        data: { alt: target.fullName },
        file: {
          data,
          mimetype: contentType,
          name: `avatar-google-${userId}.${contentType.split('/')[1]}`,
          size: data.byteLength,
        },
        overrideAccess: true,
      })
      await payload.update({
        collection: 'profiles',
        id: target.id,
        data: { avatar: media.id },
        overrideAccess: true,
      })
    }
  } catch (error) {
    logger.warn('Google profile photo import failed', {
      event: 'auth.google_avatar_import_failed',
      userId,
      ...serializeError(error),
    })
  }

  // Marked even when there was nothing to import or it failed — a broken photo URL shouldn't
  // cost every future sign-in another download attempt.
  await payload.update({
    collection: 'auth-identities',
    id: identityId,
    data: { avatarImportedAt: new Date().toISOString() },
    overrideAccess: true,
  })
}
