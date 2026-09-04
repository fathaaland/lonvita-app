import type { Access, CollectionConfig } from 'payload'

import { getAdministeredMunicipalityIds } from './access/shared'

/** A municipality admin may update their own municipality's settings (e.g. rulesForCreation,
 * brief §3 "Nastavení" tab) — a platform admin can update any. Distinct from create/delete,
 * which stay platform-admin-only (founding/removing an obec isn't a municipality_admin power). */
const canUpdateOwnMunicipality: Access = async ({ req }) => {
  const { user, payload } = req
  if (!user) return false
  if (user.role === 'admin') return true

  const administeredIds = await getAdministeredMunicipalityIds(payload, user.id)
  if (administeredIds.length === 0) return false
  return { id: { in: administeredIds } }
}

export const Municipalities: CollectionConfig = {
  slug: 'municipalities',
  labels: {
    singular: 'Municipality',
    plural: 'Municipalities',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'updatedAt'],
  },
  access: {
    read: () => true,
    create: ({ req: { user } }) => user?.role === 'admin',
    update: canUpdateOwnMunicipality,
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Municipality Name',
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'lat',
      type: 'number',
      required: true,
      admin: {
        description:
          'Brief §4 "poloha je mandatory field" — plots this obec on the municipality-switcher map (brief §4/§7 "mapka jako v Projects/eduard-app").',
      },
    },
    {
      name: 'lng',
      type: 'number',
      required: true,
    },
    {
      name: 'adminUser',
      type: 'relationship',
      relationTo: 'users',
      label: 'Municipality Admin',
      admin: {
        description: 'The user who administers this municipality.',
        position: 'sidebar',
      },
    },
    {
      name: 'eventRadiusKm',
      type: 'number',
      required: true,
      defaultValue: 15,
      admin: {
        description:
          'Maximální vzdálenost (km) mezi středem obce (lat/lng výše) a místem konání akce. Akce mimo tento okruh nejde založit ani upravit — brání přiřazení akce z jiného města k této obci.',
      },
    },
    {
      name: 'rulesForCreation',
      type: 'select',
      required: true,
      defaultValue: 'approved_organizers',
      options: [
        { label: 'Akce může zakládat pouze obec sama', value: 'municipality_only' },
        { label: 'Kdokoliv v obci může zakládat akce bez schvalování', value: 'anyone' },
        { label: 'Obec schvaluje každou žádost o roli organizátora (výchozí)', value: 'approved_organizers' },
      ],
      admin: {
        description:
          'Brief §3 "Pravidla pro vznik akcí" — controls who may create events for this municipality (see Events.access.create). A signed-out visitor is always read-only regardless of this setting.',
      },
    },
  ],
  timestamps: true,
}
