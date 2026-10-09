import type { CollectionConfig } from 'payload'

import { isLoggedIn } from './access/shared'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: () => true,
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
