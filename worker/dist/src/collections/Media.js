export const Media = {
    slug: 'media',
    access: {
        read: () => true,
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
        ],
        adminThumbnail: 'card',
    },
};
