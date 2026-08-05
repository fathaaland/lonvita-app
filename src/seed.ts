import 'dotenv/config'

import { getPayload } from 'payload'

import config from './payload.config'

const MUNICIPALITY_NAME = 'Demo obec'

const CATEGORIES = [
  { name: 'Sport', icon: 'Dumbbell', color: '#F97316' },
  { name: 'Kultura', icon: 'Music', color: '#8B5CF6' },
  { name: 'Vzdělávání', icon: 'BookOpen', color: '#3B82F6' },
  { name: 'Setkání', icon: 'Users', color: '#EC4899' },
  { name: 'Výlety', icon: 'Mountain', color: '#10B981' },
  { name: 'Zdraví', icon: 'Heart', color: '#EF4444' },
]

const run = async () => {
  const payload = await getPayload({ config })

  // Needed for the onboarding/signup pickers to have something to choose from — a
  // municipality to pick (onboarding step 4, and the /auth signup form) and interests
  // to pick from (onboarding step 3). Not tied to any seeded user's profile/role.
  payload.logger.info('Seeding municipality…')
  const existingMuni = await payload.find({
    collection: 'municipalities',
    where: { name: { equals: MUNICIPALITY_NAME } },
    limit: 1,
    overrideAccess: true,
  })
  if (!existingMuni.docs[0]) {
    await payload.create({
      collection: 'municipalities',
      data: { name: MUNICIPALITY_NAME },
      overrideAccess: true,
    })
  }

  payload.logger.info('Seeding event categories…')
  for (const cat of CATEGORIES) {
    const existing = await payload.find({
      collection: 'event-categories',
      where: { name: { equals: cat.name } },
      limit: 1,
      overrideAccess: true,
    })
    if (!existing.docs[0]) {
      await payload.create({ collection: 'event-categories', data: cat, overrideAccess: true })
    }
  }

  const seedUser = async (input: {
    email: string
    password: string
    platformRole: 'admin' | 'user'
  }) => {
    payload.logger.info(`Seeding user ${input.email}…`)

    const existingUser = await payload.find({
      collection: 'users',
      where: { email: { equals: input.email } },
      limit: 1,
      overrideAccess: true,
    })

    const user =
      existingUser.docs[0] ??
      (await payload.create({
        collection: 'users',
        data: { email: input.email, password: input.password, role: input.platformRole },
        overrideAccess: true,
      }))

    // Re-running the seed should reset the password/role to known values even if an
    // existing user was found (e.g. after manual edits in the admin UI).
    if (existingUser.docs[0]) {
      await payload.update({
        collection: 'users',
        id: user.id,
        data: { password: input.password, role: input.platformRole },
        overrideAccess: true,
      })
    }

    // These are shared, publicly-known dev/demo credentials — a few failed attempts (typos,
    // stale autofill) shouldn't lock the account out for 10 minutes. Always clear it on seed.
    await payload.unlock({
      collection: 'users',
      data: { email: input.email, password: input.password },
      overrideAccess: true,
    })
  }

  // Bare login accounts only — no profile/role/consent. Everything else (profiles,
  // community roles) is set up afterwards through onboarding or the superadmin panel.
  await seedUser({
    email: 'superadmin@lonvita.cz',
    password: 'superadmin1234',
    platformRole: 'admin',
  })

  await seedUser({
    email: 'admin@admin.cz',
    password: 'admin1234',
    platformRole: 'user',
  })

  await seedUser({
    email: 'ucastnik@ucastnik.cz',
    password: 'ucastnik1234',
    platformRole: 'user',
  })

  payload.logger.info('Seed complete.')
  process.exit(0)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
