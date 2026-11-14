import type { Payload } from 'payload'

import { notDeleted } from '@/collections/shared/softDelete'
import { APP_TIME_ZONE } from '@/lib/date'
import { relationId } from '@/lib/relations'

import { zipFiles } from './zip'

/**
 * Everything the obec has in Lonvita, for it to take along when its contract ends (GDPR čl. 28(3)(g):
 * we process it for the obec, which is the controller) — or just to keep. A ZIP of CSVs: its events,
 * the sign-ups for them with attendance, its organizations and who holds which role. Names only:
 * e-mails and phone numbers are the people's account data, not the obec's.
 */

const STATUS: Record<string, string> = {
  active: 'aktivní',
  full: 'plná',
  finished: 'proběhla',
  cancelled: 'zrušená',
  pending: 'čeká',
  approved: 'schváleno',
  rejected: 'zamítnuto',
}
const ATTENDANCE: Record<string, string> = {
  not_marked: 'neoznačeno',
  attended: 'přišel/přišla',
  no_show: 'nepřišel/nepřišla',
  excused: 'omluven(a)',
}
const ROLES: Record<string, string> = {
  municipality_admin: 'admin obce',
  organizer: 'organizátor',
  participant: 'účastník',
  volunteer: 'dobrovolník',
}

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('cs-CZ', { timeZone: APP_TIME_ZONE }) : ''

/** A cell starting with = + - @ is a formula to Excel — kept as text (the same as buildEventsCsv). */
const cell = (v: unknown) => {
  const text = v == null ? '' : String(v)
  return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`
}
/** With a BOM — Excel reads it as UTF-8, diacritics intact. */
const csv = (header: string[], rows: unknown[][]) =>
  Buffer.from(`﻿${[header, ...rows].map((r) => r.map(cell).join(',')).join('\n')}`, 'utf-8')

const IN_CHUNKS = 500

export async function buildMunicipalityArchive(
  payload: Payload,
  municipalityId: string,
  now: Date = new Date(),
): Promise<{ body: Buffer; municipalityName: string }> {
  const find = <T>(args: Parameters<Payload['find']>[0]) =>
    payload.find({ depth: 0, pagination: false, overrideAccess: true, ...args }) as unknown as Promise<{ docs: T[] }>

  const municipality = await payload.findByID({ collection: 'municipalities', id: municipalityId, depth: 0, overrideAccess: true })
  type EventDoc = {
    id: number
    title: string
    dateTime: string
    endDateTime?: string | null
    locationText?: string | null
    capacity?: number | null
    status?: string | null
    isDraft?: boolean | null
    isPaid?: boolean | null
    isVolunteering?: boolean | null
    organizer?: unknown
    organization?: unknown
    categories?: unknown[] | null
    createdAt: string
  }
  const [events, organizations, roles, categories] = await Promise.all([
    find<EventDoc>({ collection: 'events', where: { and: [{ municipality: { equals: municipalityId } }, notDeleted] }, sort: 'dateTime' }),
    find<{ id: number; name: string; type?: string | null; owner?: unknown; createdAt: string }>({
      collection: 'organizations',
      where: { and: [{ municipality: { equals: municipalityId } }, notDeleted] },
      sort: 'name',
    }),
    find<{ user?: unknown; role?: string | null; createdAt: string }>({
      collection: 'user-roles',
      where: { municipality: { equals: municipalityId } },
      sort: 'createdAt',
    }),
    find<{ id: number; name: string }>({ collection: 'event-categories' }),
  ])
  // Cancelled events stay in the obec's record — only someone's unpublished draft is theirs alone.
  const eventDocs = events.docs.filter((e) => !e.isDraft)

  type RegistrationDoc = {
    event?: unknown
    user?: unknown
    status?: string | null
    role?: string | null
    attendanceStatus?: string | null
    selfCancelled?: boolean | null
    createdAt: string
  }
  const registrations: RegistrationDoc[] = []
  const eventIds = eventDocs.map((e) => e.id)
  for (let i = 0; i < eventIds.length; i += IN_CHUNKS) {
    const chunk = await find<RegistrationDoc>({
      collection: 'registrations',
      where: { event: { in: eventIds.slice(i, i + IN_CHUNKS) } },
      sort: 'createdAt',
    })
    registrations.push(...chunk.docs)
  }

  const userIds = [
    ...new Set(
      [
        ...eventDocs.map((e) => relationId(e.organizer)),
        ...registrations.map((r) => relationId(r.user)),
        ...organizations.docs.map((o) => relationId(o.owner)),
        ...roles.docs.map((r) => relationId(r.user)),
      ].filter((id): id is string => id !== null),
    ),
  ]
  const names = new Map<string, string>()
  for (let i = 0; i < userIds.length; i += IN_CHUNKS) {
    const profiles = await find<{ user?: unknown; fullName?: string | null }>({
      collection: 'profiles',
      where: { user: { in: userIds.slice(i, i + IN_CHUNKS) } },
      select: { user: true, fullName: true },
    })
    for (const p of profiles.docs) {
      const id = relationId(p.user)
      if (id) names.set(id, p.fullName?.trim() || 'Bez jména')
    }
  }
  const nameOf = (user: unknown) => {
    const id = relationId(user)
    return id ? (names.get(id) ?? 'Smazaný účet') : ''
  }
  const categoryName = new Map(categories.docs.map((c) => [String(c.id), c.name]))
  const organizationName = new Map(organizations.docs.map((o) => [String(o.id), o.name]))
  const eventTitle = new Map(eventDocs.map((e) => [String(e.id), e.title]))

  const files = [
    {
      name: 'akce.csv',
      body: csv(
        ['ID', 'Název', 'Začátek', 'Konec', 'Místo', 'Kategorie', 'Pořadatel', 'Organizace', 'Kapacita', 'Stav', 'Placená', 'Dobrovolnická', 'Založeno'],
        eventDocs.map((e) => [
          e.id,
          e.title,
          when(e.dateTime),
          when(e.endDateTime),
          e.locationText ?? '',
          (e.categories ?? []).map((c) => categoryName.get(relationId(c) ?? '')).filter(Boolean).join(', '),
          nameOf(e.organizer),
          organizationName.get(relationId(e.organization) ?? '') ?? '',
          e.capacity ?? '',
          STATUS[e.status ?? ''] ?? e.status ?? '',
          e.isPaid ? 'ano' : 'ne',
          e.isVolunteering ? 'ano' : 'ne',
          when(e.createdAt),
        ]),
      ),
    },
    {
      name: 'prihlasky.csv',
      body: csv(
        ['ID akce', 'Akce', 'Jméno', 'Role', 'Stav', 'Odhlásil(a) se sám/sama', 'Docházka', 'Přihlášeno'],
        registrations.map((r) => [
          relationId(r.event) ?? '',
          eventTitle.get(relationId(r.event) ?? '') ?? '',
          nameOf(r.user),
          ROLES[r.role ?? ''] ?? r.role ?? '',
          r.status === 'cancelled' ? 'zrušeno' : (STATUS[r.status ?? ''] ?? r.status ?? ''),
          r.selfCancelled ? 'ano' : '',
          ATTENDANCE[r.attendanceStatus ?? ''] ?? '',
          when(r.createdAt),
        ]),
      ),
    },
    {
      name: 'organizace.csv',
      body: csv(
        ['Název', 'Typ', 'Správce', 'Založeno'],
        organizations.docs.map((o) => [o.name, o.type ?? '', nameOf(o.owner), when(o.createdAt)]),
      ),
    },
    {
      name: 'role.csv',
      body: csv(
        ['Jméno', 'Role', 'Od'],
        roles.docs.map((r) => [nameOf(r.user), ROLES[r.role ?? ''] ?? r.role ?? '', when(r.createdAt)]),
      ),
    },
    {
      name: 'README.txt',
      body: Buffer.from(
        [
          `Data obce ${municipality.name} z Lonvity, stažená ${when(now.toISOString())}.`,
          '',
          'akce.csv        — všechny zveřejněné akce obce, i zrušené',
          'prihlasky.csv   — přihlášky na ně, včetně docházky',
          'organizace.csv  — spolky a organizace v obci',
          'role.csv        — kdo v obci spravuje nebo pořádá akce',
          '',
          'Soubory jsou v UTF-8 a otevřou se v Excelu i v LibreOffice.',
          'E-maily a telefony obsažené nejsou — patří k účtům lidí, ne k údajům obce.',
        ].join('\r\n'),
        'utf-8',
      ),
    },
  ]
  return { body: zipFiles(files, now), municipalityName: municipality.name }
}
