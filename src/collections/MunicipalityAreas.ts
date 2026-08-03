import type { CollectionConfig } from 'payload'

import { isLoggedIn } from './access/shared'

export const MunicipalityAreas: CollectionConfig = {
  slug: 'municipality-areas',
  labels: {
    singular: 'Municipality Area',
    plural: 'Municipality Areas',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'municipality', 'code', 'updatedAt'],
    description: 'Neighborhoods within a municipality, used for the onboarding "where do you live" map.',
  },
  access: {
    read: isLoggedIn,
    create: ({ req: { user } }) => user?.role === 'admin',
    update: ({ req: { user } }) => user?.role === 'admin',
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
      required: true,
    },
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'code',
      type: 'text',
      required: true,
      admin: {
        description: 'Short slug-like identifier, unique within the municipality.',
      },
    },
    {
      name: 'centerLat',
      type: 'number',
      required: true,
    },
    {
      name: 'centerLng',
      type: 'number',
      required: true,
    },
    {
      name: 'radiusM',
      type: 'number',
      required: true,
      defaultValue: 400,
    },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, req, operation, originalDoc }) => {
        if (!data?.municipality || !data?.code) return data

        if (
          operation === 'update' &&
          originalDoc?.municipality === data.municipality &&
          originalDoc?.code === data.code
        ) {
          return data
        }

        const existing = await req.payload.find({
          collection: 'municipality-areas',
          where: {
            and: [{ municipality: { equals: data.municipality } }, { code: { equals: data.code } }],
          },
          limit: 1,
        })

        if (existing.docs.length > 0) {
          throw new Error(`An area with code "${data.code}" already exists in this municipality.`)
        }

        return data
      },
    ],
  },
  timestamps: true,
}
