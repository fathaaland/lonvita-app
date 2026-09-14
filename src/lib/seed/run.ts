import type { Payload } from 'payload'

import type { User } from '@/payload-types'

const CATEGORIES = [
  { name: 'Sport', icon: 'Dumbbell', color: '#F97316' },
  { name: 'Kultura', icon: 'Music', color: '#8B5CF6' },
  { name: 'Vzdělávání', icon: 'BookOpen', color: '#3B82F6' },
  { name: 'Setkání', icon: 'Users', color: '#EC4899' },
  { name: 'Výlety', icon: 'Mountain', color: '#10B981' },
  { name: 'Zdraví', icon: 'Heart', color: '#EF4444' },
] as const

const isProduction = () => process.env.NODE_ENV === 'production'

/** Known-password accounts for local development (and demo deployments with SEED_DEMO_DATA=true) —
 * their passwords are reset on every boot so the documented logins keep working. The seed runs on
 * every boot in every environment (payload.config onInit), so these must never reach a production
 * database: that used to give each deployment a superadmin with a publicly known password. */
const DEV_ACCOUNTS = [
  { email: 'superadmin@lonvita.cz', password: 'superadmin1234', platformRole: 'admin' as const },
  { email: 'admin@admin.cz', password: 'admin1234', platformRole: 'user' as const },
  { email: 'ucastnik@ucastnik.cz', password: 'ucastnik1234', platformRole: 'user' as const },
]

const SUPERADMIN_PASSWORD_MIN_LENGTH = 12

/** Production's first platform superadmin comes from SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD
 * (deployment secrets) and is only ever created — an existing account's password and role are never
 * touched, so rotating the password in the app sticks and a leaked env value can't reset it. */
async function bootstrapProductionSuperadmin(payload: Payload): Promise<void> {
  const email = process.env.SEED_SUPERADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.SEED_SUPERADMIN_PASSWORD
  if (!email || !password) {
    payload.logger.info('SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD not set — skipping superadmin bootstrap.')
    return
  }
  if (password.length < SUPERADMIN_PASSWORD_MIN_LENGTH) {
    payload.logger.warn(
      `SEED_SUPERADMIN_PASSWORD must be at least ${SUPERADMIN_PASSWORD_MIN_LENGTH} characters — skipping superadmin bootstrap.`,
    )
    return
  }

  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (existing.docs[0]) return

  await payload.create({
    collection: 'users',
    data: { email, password, role: 'admin' },
    overrideAccess: true,
  })
  payload.logger.info(`Created superadmin ${email} from SEED_SUPERADMIN_EMAIL.`)
}

// --- Demo data --------------------------------------------------------------------------------
// Seeded only outside production (or with SEED_DEMO_DATA=true): the pilot towns, a handful of
// people and events, so a fresh local database looks like an obec actually using Lonvita. The
// seed runs on every boot, so it's deterministic and create-if-missing — it converges to the same
// data instead of reshuffling it, and never overwrites what was edited in the app. Demo-only people
// use example.com addresses so nothing seeded can ever reach a real inbox.

const shouldSeedDemoData = () => !isProduction() || process.env.SEED_DEMO_DATA === 'true'

const DEMO_PASSWORD = 'demo1234'

const MUNICIPALITIES = [
  { name: 'Nové Veselí', description: 'Nové Veselí na Žďársku', lat: 49.5198752, lng: 15.9084979 },
  { name: 'Hamry nad Sázavou', description: null, lat: 49.5660235, lng: 15.9016868 },
  { name: 'Blansko', description: null, lat: 49.3636494, lng: 16.6442394 },
  { name: 'Praha', description: null, lat: 50.0874654, lng: 14.4212535 },
  { name: 'Brno', description: null, lat: 49.1922443, lng: 16.6113382 },
] as const

type MunicipalityName = (typeof MUNICIPALITIES)[number]['name']
type CategoryName = (typeof CATEGORIES)[number]['name']
type AccessibilityTag = 'wheelchair_access' | 'induction_loop' | 'seating' | 'accessible_wc'

type DemoPerson = {
  email: string
  /** Demo-only accounts get DEMO_PASSWORD; the SEED_USERS above keep their own logins. */
  demoAccount?: boolean
  fullName: string
  /** null = "bez obce". */
  municipality: MunicipalityName | null
  phone: string
  dateOfBirth: string
  gender: 'zena' | 'muz' | 'jine' | 'neuvedeno'
  interests: CategoryName[]
  volunteer?: { focus: string[]; note: string }
  roles: { role: 'participant' | 'municipality_admin' | 'organizer'; municipality: MunicipalityName }[]
}

const DEMO_PEOPLE: DemoPerson[] = [
  {
    email: 'superadmin@lonvita.cz',
    fullName: 'Správce Lonvity',
    municipality: null,
    phone: '+420 602 481 739',
    dateOfBirth: '1990-03-14',
    gender: 'neuvedeno',
    interests: [],
    roles: [],
  },
  {
    email: 'admin@admin.cz',
    fullName: 'Jana Nováková',
    municipality: 'Nové Veselí',
    phone: '+420 604 218 377',
    dateOfBirth: '1978-04-12',
    gender: 'zena',
    interests: ['Kultura', 'Setkání'],
    roles: [
      { role: 'participant', municipality: 'Nové Veselí' },
      { role: 'municipality_admin', municipality: 'Nové Veselí' },
    ],
  },
  {
    email: 'ucastnik@ucastnik.cz',
    fullName: 'Petr Dvořák',
    municipality: 'Nové Veselí',
    phone: '+420 731 552 904',
    dateOfBirth: '1956-09-23',
    gender: 'muz',
    interests: ['Výlety', 'Zdraví', 'Sport'],
    roles: [{ role: 'participant', municipality: 'Nové Veselí' }],
  },
  {
    email: 'marie.svobodova@example.com',
    demoAccount: true,
    fullName: 'Marie Svobodová',
    municipality: 'Nové Veselí',
    phone: '+420 605 318 442',
    dateOfBirth: '1949-02-17',
    gender: 'zena',
    interests: ['Kultura', 'Setkání', 'Zdraví'],
    volunteer: { focus: ['doprava', 'socialni'], note: 'Mám auto, ráda odvezu sousedy na akce.' },
    roles: [{ role: 'participant', municipality: 'Nové Veselí' }],
  },
  {
    email: 'tomas.cerny@example.com',
    demoAccount: true,
    fullName: 'Tomáš Černý',
    municipality: 'Nové Veselí',
    phone: '+420 737 204 615',
    dateOfBirth: '1984-07-03',
    gender: 'muz',
    interests: ['Sport', 'Výlety'],
    roles: [
      { role: 'participant', municipality: 'Nové Veselí' },
      { role: 'organizer', municipality: 'Nové Veselí' },
    ],
  },
  {
    email: 'eva.prochazkova@example.com',
    demoAccount: true,
    fullName: 'Eva Procházková',
    municipality: null,
    phone: '+420 721 640 318',
    dateOfBirth: '1968-11-29',
    gender: 'zena',
    interests: ['Vzdělávání', 'Kultura'],
    roles: [],
  },
  {
    email: 'jiri.kucera@example.com',
    demoAccount: true,
    fullName: 'Jiří Kučera',
    municipality: 'Brno',
    phone: '+420 776 915 203',
    dateOfBirth: '1952-05-08',
    gender: 'muz',
    interests: ['Výlety', 'Setkání'],
    roles: [{ role: 'participant', municipality: 'Brno' }],
  },
]

const DEMO_ORGANIZATIONS = [{ name: 'TJ Sokol Nové Veselí', owner: 'tomas.cerny@example.com' }]

type DemoEvent = {
  title: string
  description: string
  municipality: MunicipalityName
  organizer: string
  organization?: string
  categories: CategoryName[]
  /** Days from the first seed run, at a local [hours, minutes]. */
  inDays: number
  at: readonly [number, number]
  locationText: string
  lat: number
  lng: number
  capacity: number
  approval: 'auto' | 'manual'
  priceCzk?: number
  accessibility: AccessibilityTag[]
  registrations: { email: string; status: 'approved' | 'pending' }[]
}

const DEMO_EVENTS: DemoEvent[] = [
  {
    title: 'Setkání u kávy a dortu',
    description:
      'Posedíme u kávy a domácího dortu a popovídáme si o tom, co se v obci chystá. Přijďte klidně i sami — rádi vás seznámíme s ostatními.',
    municipality: 'Nové Veselí',
    organizer: 'admin@admin.cz',
    categories: ['Setkání'],
    inDays: 2,
    at: [15, 0],
    locationText: 'Kavárna U Radnice, Nové Veselí',
    lat: 49.5205,
    lng: 15.9095,
    capacity: 25,
    approval: 'manual',
    priceCzk: 30,
    accessibility: ['wheelchair_access', 'seating'],
    registrations: [
      { email: 'ucastnik@ucastnik.cz', status: 'approved' },
      { email: 'marie.svobodova@example.com', status: 'pending' },
    ],
  },
  {
    title: 'Procházka kolem Veselského rybníka',
    description:
      'Nenáročná asi čtyřkilometrová procházka po rovině kolem rybníka. Tempo přizpůsobíme všem, po cestě jsou lavičky na odpočinek.',
    municipality: 'Nové Veselí',
    organizer: 'admin@admin.cz',
    categories: ['Výlety', 'Zdraví'],
    inDays: 4,
    at: [9, 30],
    locationText: 'Hráz Veselského rybníka, Nové Veselí',
    lat: 49.5231,
    lng: 15.9112,
    capacity: 15,
    approval: 'auto',
    accessibility: ['seating'],
    registrations: [
      { email: 'ucastnik@ucastnik.cz', status: 'approved' },
      { email: 'marie.svobodova@example.com', status: 'approved' },
      { email: 'jiri.kucera@example.com', status: 'approved' },
    ],
  },
  {
    title: 'Odpolední čtení v knihovně',
    description:
      'Společně si přečteme povídky českých autorů a u čaje si o nich popovídáme. Knihy zapůjčíme, stačí přijít.',
    municipality: 'Nové Veselí',
    organizer: 'admin@admin.cz',
    categories: ['Kultura', 'Vzdělávání'],
    inDays: 7,
    at: [16, 0],
    locationText: 'Místní knihovna, Nové Veselí',
    lat: 49.5199,
    lng: 15.9086,
    capacity: 12,
    approval: 'manual',
    accessibility: ['wheelchair_access', 'induction_loop', 'accessible_wc'],
    registrations: [
      { email: 'marie.svobodova@example.com', status: 'approved' },
      { email: 'eva.prochazkova@example.com', status: 'pending' },
    ],
  },
  {
    title: 'Turnaj v pétanque',
    description:
      'Přátelský turnaj pro začátečníky i zkušené hráče. Koule zapůjčíme, hraje se ve dvojicích, které losujeme na místě.',
    municipality: 'Nové Veselí',
    organizer: 'tomas.cerny@example.com',
    organization: 'TJ Sokol Nové Veselí',
    categories: ['Sport', 'Setkání'],
    inDays: 10,
    at: [14, 0],
    locationText: 'Hřiště TJ Sokol, Nové Veselí',
    lat: 49.5178,
    lng: 15.9051,
    capacity: 20,
    approval: 'auto',
    priceCzk: 50,
    accessibility: ['seating'],
    registrations: [
      { email: 'ucastnik@ucastnik.cz', status: 'approved' },
      { email: 'eva.prochazkova@example.com', status: 'approved' },
    ],
  },
]

async function seedUser(
  payload: Payload,
  input: { email: string; password: string; platformRole: 'admin' | 'user' },
): Promise<User> {
  payload.logger.info(`Seeding user ${input.email}…`)
  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: input.email } },
    limit: 1,
    overrideAccess: true,
  })
  const user =
    existing.docs[0] ??
    (await payload.create({
      collection: 'users',
      data: { email: input.email, password: input.password, role: input.platformRole },
      overrideAccess: true,
    }))

  if (existing.docs[0]) {
    await payload.update({
      collection: 'users',
      id: user.id,
      data: { password: input.password, role: input.platformRole },
      overrideAccess: true,
    })
  }

  await payload.unlock({
    collection: 'users',
    data: { email: input.email, password: input.password },
    overrideAccess: true,
  })

  return user
}

async function findUserId(payload: Payload, email: string): Promise<number | null> {
  const result = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return result.docs[0]?.id ?? null
}

async function ensureMunicipality(payload: Payload, input: (typeof MUNICIPALITIES)[number]): Promise<number> {
  const existing = await payload.find({
    collection: 'municipalities',
    where: { name: { equals: input.name } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (existing.docs[0]) return existing.docs[0].id

  const created = await payload.create({
    collection: 'municipalities',
    data: {
      name: input.name,
      description: input.description,
      lat: input.lat,
      lng: input.lng,
      eventRadiusKm: 15,
      rulesForCreation: 'approved_organizers',
    },
    overrideAccess: true,
  })
  return created.id
}

const localDateTime = (inDays: number, [hours, minutes]: readonly [number, number]): string => {
  const date = new Date()
  date.setDate(date.getDate() + inDays)
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

async function seedDemoData(payload: Payload, categoryIds: Map<string, number>): Promise<void> {
  payload.logger.info('Seeding demo municipalities, people and events…')

  const municipalityIds = new Map<string, number>()
  for (const municipality of MUNICIPALITIES) {
    municipalityIds.set(municipality.name, await ensureMunicipality(payload, municipality))
  }

  const userIds = new Map<string, number>()
  for (const person of DEMO_PEOPLE) {
    const userId = person.demoAccount
      ? (await seedUser(payload, { email: person.email, password: DEMO_PASSWORD, platformRole: 'user' })).id
      : await findUserId(payload, person.email)
    if (!userId) continue
    userIds.set(person.email, userId)

    const existingProfile = await payload.find({
      collection: 'profiles',
      where: { user: { equals: userId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (!existingProfile.docs[0]) {
      await payload.create({
        collection: 'profiles',
        data: {
          user: userId,
          fullName: person.fullName,
          municipality: person.municipality ? municipalityIds.get(person.municipality) : null,
          phone: person.phone,
          dateOfBirth: person.dateOfBirth,
          gender: person.gender,
          interests: person.interests.map((name) => categoryIds.get(name)).filter((id): id is number => id !== undefined),
          isVolunteer: Boolean(person.volunteer),
          volunteerFocus: person.volunteer?.focus ?? [],
          volunteerNote: person.volunteer?.note ?? null,
          volunteerSince: person.volunteer ? new Date().toISOString() : null,
          onboardingCompleted: true,
        },
        overrideAccess: true,
      })
    }

    for (const { role, municipality } of person.roles) {
      const municipalityId = municipalityIds.get(municipality)!
      const existingRole = await payload.find({
        collection: 'user-roles',
        where: {
          and: [{ user: { equals: userId } }, { municipality: { equals: municipalityId } }, { role: { equals: role } }],
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      if (!existingRole.docs[0]) {
        await payload.create({
          collection: 'user-roles',
          data: { user: userId, municipality: municipalityId, role },
          overrideAccess: true,
        })
      }
    }
  }

  const organizationIds = new Map<string, number>()
  for (const organization of DEMO_ORGANIZATIONS) {
    const ownerId = userIds.get(organization.owner)
    if (!ownerId) continue
    const existing = await payload.find({
      collection: 'organizations',
      where: { and: [{ name: { equals: organization.name } }, { owner: { equals: ownerId } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const id =
      existing.docs[0]?.id ??
      (await payload.create({ collection: 'organizations', data: { name: organization.name, owner: ownerId }, overrideAccess: true })).id
    organizationIds.set(organization.name, id)
  }

  for (const event of DEMO_EVENTS) {
    const municipalityId = municipalityIds.get(event.municipality)!
    const organizerId = userIds.get(event.organizer)
    if (!organizerId) continue

    const existing = await payload.find({
      collection: 'events',
      where: { and: [{ title: { equals: event.title } }, { municipality: { equals: municipalityId } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    let eventId = existing.docs[0]?.id
    if (!eventId) {
      const created = await payload.create({
        collection: 'events',
        data: {
          title: event.title,
          description: event.description,
          municipality: municipalityId,
          dateTime: localDateTime(event.inDays, event.at),
          locationText: event.locationText,
          lat: event.lat,
          lng: event.lng,
          accessibilityTags: event.accessibility,
          capacity: event.capacity,
          registrationApprovalMode: event.approval,
          organizer: organizerId,
          organization: event.organization ? organizationIds.get(event.organization) : undefined,
          categories: event.categories.map((name) => categoryIds.get(name)).filter((id): id is number => id !== undefined),
          status: 'active',
          isPaid: Boolean(event.priceCzk),
          priceCents: event.priceCzk ? event.priceCzk * 100 : undefined,
          cancellationPolicy: 'cancel_48h',
        },
        context: { skipNotifications: true },
        overrideAccess: true,
      })
      eventId = created.id
    }

    for (const registration of event.registrations) {
      const userId = userIds.get(registration.email)
      if (!userId) continue
      const existingRegistration = await payload.find({
        collection: 'registrations',
        where: {
          and: [{ event: { equals: eventId } }, { user: { equals: userId } }, { status: { not_equals: 'cancelled' } }],
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      if (!existingRegistration.docs[0]) {
        await payload.create({
          collection: 'registrations',
          data: { event: eventId, user: userId, status: registration.status },
          context: { skipNotifications: true },
          overrideAccess: true,
        })
      }
    }
  }
}

export async function runSeed(payload: Payload) {
  payload.logger.info('Seeding event categories…')
  const categoryIds = new Map<string, number>()
  for (const cat of CATEGORIES) {
    const existing = await payload.find({
      collection: 'event-categories',
      where: { name: { equals: cat.name } },
      limit: 1,
      overrideAccess: true,
    })
    const id =
      existing.docs[0]?.id ??
      (await payload.create({ collection: 'event-categories', data: { ...cat }, overrideAccess: true })).id
    categoryIds.set(cat.name, id)
  }

  if (isProduction()) {
    await bootstrapProductionSuperadmin(payload)
  }

  if (shouldSeedDemoData()) {
    for (const account of DEV_ACCOUNTS) {
      // A demo deployment (production + SEED_DEMO_DATA) still gets its superadmin only from SEED_SUPERADMIN_*.
      if (isProduction() && account.platformRole === 'admin') continue
      await seedUser(payload, account)
    }
    await seedDemoData(payload, categoryIds)
  }

  payload.logger.info('Seed complete.')
}
