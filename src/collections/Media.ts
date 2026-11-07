import type { Access, CollectionConfig } from 'payload'

import { isLoggedIn } from './access/shared'

/**
 * The files themselves stay public (event covers on the anonymous homepage, populated through
 * events/organizations/profiles with depth). What's closed is enumerating the collection: a plain
 * GET /api/media used to list every upload with its alt — for avatars that's the person's name.
 * A direct REST read on media now has to name the rows it wants: findByID, or a where that is only
 * `id equals` / `id in [...]` (how the app looks up avatars in a batch). Any other operator or
 * field (`where[id][exists]`, `where[id][greater_than]`, a second key such as `alt`) used to pass
 * the "has an id key" check and list everything. Anonymous visitors get no direct REST access.
 * Avatars carry no name in `alt` either (see the uploads), since ids are sequential.
 */
const MAX_MEDIA_IDS = 500

export const namesRowsOnly = (where: unknown): boolean => {
  if (!where || typeof where !== 'object' || Array.isArray(where)) return false
  const keys = Object.keys(where)
  if (keys.length !== 1 || keys[0] !== 'id') return false
  const condition = (where as { id: unknown }).id
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return false
  const operators = Object.entries(condition as Record<string, unknown>)
  if (operators.length !== 1) return false
  const [operator, value] = operators[0]
  if (operator === 'equals') return typeof value === 'string' || typeof value === 'number'
  if (operator === 'in') {
    // qs parses `in[]=1&in[]=2` into an array (an index-keyed object past its arrayLimit),
    // `in=1,2` into a string.
    const ids = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : value && typeof value === 'object' && Object.keys(value).every((k) => /^\d+$/.test(k))
          ? Object.values(value)
          : null
    return ids !== null && ids.length > 0 && ids.length <= MAX_MEDIA_IDS
  }
  return false
}

const readMedia: Access = ({ req, isReadingStaticFile }) => {
  if (isReadingStaticFile || req.user?.role === 'admin') return true
  const direct = req.routeParams?.collection === 'media'
  if (!direct) return true
  if (!req.user) return false
  if (req.routeParams?.id) return true
  return namesRowsOnly((req.query as { where?: unknown } | undefined)?.where)
}

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: readMedia,
    // Event covers, avatars and organization logos are uploaded straight from the browser.
    create: isLoggedIn,
    // Spelled out because Payload's default for a missing operation is "any signed-in user" —
    // which let anybody PATCH a new file over someone else's event photo, or DELETE it. Nothing in
    // the app edits or removes a media row over REST: a replaced photo is a new upload, and
    // account anonymization removes files through the Local API (overrideAccess).
    update: ({ req: { user } }) => user?.role === 'admin',
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
  upload: {
    // Formats every browser can display — e.g. a HEIC upload used to be stored as
    // application/octet-stream with no card crop, and then never rendered anywhere.
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    // Brief §4 "Nahrání fotografie k akci, s pevně daným ořezem pro přehledovou stránku" —
    // a fixed 16:10 crop (matches EventCard's aspect-[16/10]) so the overview grid never has
    // ragged/empty space. `crop`/`focalPoint` default to true, giving the uploader a cropper.
    imageSizes: [
      // The event photo as the cards and the detail show it — downscaled, not cropped, so the
      // organizer's framing (Events imagePositionX/Y, object-position) still applies. A card is at
      // most ~480 CSS px wide, so 960 covers a 2× screen; the original (up to 2560 px) is left for
      // the detail on a big screen (srcSet).
      {
        name: 'display',
        width: 960,
        withoutEnlargement: true,
      },
      {
        name: 'card',
        width: 800,
        height: 500,
        position: 'centre',
      },
      // Profile photos — a square crop so a portrait phone photo fills the round avatar
      // instead of being squashed, and lists of participants don't pull full-size originals.
      {
        name: 'avatar',
        width: 320,
        height: 320,
        position: 'centre',
      },
    ],
    adminThumbnail: 'card',
  },
}
