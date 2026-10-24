import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { auditDeletion } from './shared/auditLog'
import { relationId } from '@/lib/relations'

const platformAdmin = ({ req: { user } }: { req: { user?: { role?: string | null } | null } }) =>
  user?.role === 'admin'

/** A region is 1–N obce, each in no other region; its main obec is one of them — the first, unless
 * the platform admin picked another. */
const validateMembers: CollectionBeforeValidateHook = async ({ data, req, originalDoc }) => {
  if (!data) return data
  const name = typeof data.name === 'string' ? data.name.trim() : (originalDoc?.name ?? '')
  if (!name) throw new APIError('Zadejte název mikroregionu.', 400)
  const members = [
    ...new Set(
      ((data.municipalities ?? originalDoc?.municipalities ?? []) as unknown[])
        .map(relationId)
        .filter((id): id is string => id !== null),
    ),
  ]
  if (members.length === 0) throw new APIError('Mikroregion musí mít aspoň jednu obec.', 400)

  const elsewhere = await req.payload.find({
    collection: 'microregions',
    where: {
      and: [
        { municipalities: { in: members } },
        ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
      ],
    },
    depth: 1,
    limit: 1,
    overrideAccess: true,
    req,
  })
  if (elsewhere.docs[0]) {
    throw new APIError(
      `Obec už patří do mikroregionu „${elsewhere.docs[0].name}“ — obec může být jen v jednom.`,
      400,
    )
  }

  const main = relationId(data.mainMunicipality ?? originalDoc?.mainMunicipality)
  return {
    ...data,
    name,
    municipalities: members.map(Number),
    mainMunicipality: Number(main && members.includes(main) ? main : members[0]),
  }
}

/**
 * Mikroregion — obce sharing one view (lib/microregions): each other's events, volunteers and
 * co-organizing. Kept by the platform's admins (the superadmin panel); anyone may read which obce
 * belong together, as the event list does.
 */
export const Microregions: CollectionConfig = {
  slug: 'microregions',
  labels: { singular: 'Microregion', plural: 'Microregions' },
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'mainMunicipality', 'municipalities'] },
  access: {
    read: () => true,
    create: platformAdmin,
    update: platformAdmin,
    delete: platformAdmin,
  },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 120 },
    { name: 'mainMunicipality', type: 'relationship', relationTo: 'municipalities' },
    {
      name: 'municipalities',
      type: 'relationship',
      relationTo: 'municipalities',
      hasMany: true,
      required: true,
      index: true,
    },
  ],
  hooks: {
    beforeValidate: [validateMembers],
    afterDelete: [auditDeletion<{ name?: string }>((doc) => ({ metadata: { name: doc.name } }))],
  },
  timestamps: true,
}
