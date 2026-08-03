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

const AREAS = [
  { name: 'Centrum', code: 'centrum', centerLat: 50.1372, centerLng: 14.4381 },
  { name: 'Staré Město', code: 'stare-mesto', centerLat: 50.1401, centerLng: 14.4312 },
  { name: 'Nová čtvrť', code: 'nova-ctvrt', centerLat: 50.1332, centerLng: 14.4429 },
  { name: 'Sídliště', code: 'sidliste', centerLat: 50.1290, centerLng: 14.4480 },
  { name: 'Okraj', code: 'okraj', centerLat: 50.1440, centerLng: 14.4230 },
]

const run = async () => {
  const payload = await getPayload({ config })

  payload.logger.info('Seeding municipality…')
  const existingMuni = await payload.find({
    collection: 'municipalities',
    where: { name: { equals: MUNICIPALITY_NAME } },
    limit: 1,
    overrideAccess: true,
  })
  const municipality =
    existingMuni.docs[0] ??
    (await payload.create({
      collection: 'municipalities',
      data: { name: MUNICIPALITY_NAME, rulesForCreation: 'approved_organizers' },
      overrideAccess: true,
    }))

  payload.logger.info('Seeding event categories…')
  const categoryIds: number[] = []
  for (const cat of CATEGORIES) {
    const existing = await payload.find({
      collection: 'event-categories',
      where: { name: { equals: cat.name } },
      limit: 1,
      overrideAccess: true,
    })
    const doc =
      existing.docs[0] ??
      (await payload.create({ collection: 'event-categories', data: cat, overrideAccess: true }))
    categoryIds.push(doc.id)
  }

  payload.logger.info('Seeding municipality areas…')
  const areaIds: number[] = []
  for (const area of AREAS) {
    const existing = await payload.find({
      collection: 'municipality-areas',
      where: { and: [{ municipality: { equals: municipality.id } }, { code: { equals: area.code } }] },
      limit: 1,
      overrideAccess: true,
    })
    const doc =
      existing.docs[0] ??
      (await payload.create({
        collection: 'municipality-areas',
        data: { ...area, municipality: municipality.id, radiusM: 400 },
        overrideAccess: true,
      }))
    areaIds.push(doc.id)
  }

  const seedAccount = async (input: {
    email: string
    password: string
    fullName: string
    platformRole: 'admin' | 'user'
    communityRole: 'municipality_admin' | 'organizer' | null
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

    const existingProfile = await payload.find({
      collection: 'profiles',
      where: { user: { equals: user.id } },
      limit: 1,
      overrideAccess: true,
    })
    const profileData = {
      user: user.id,
      fullName: input.fullName,
      municipality: municipality.id,
      dateOfBirth: '1990-01-01',
      gender: 'neuvedeno' as const,
      interests: categoryIds.slice(0, 2),
      homeArea: areaIds[0],
      onboardingCompleted: true,
    }
    if (existingProfile.docs[0]) {
      await payload.update({
        collection: 'profiles',
        id: existingProfile.docs[0].id,
        data: profileData,
        overrideAccess: true,
      })
    } else {
      await payload.create({ collection: 'profiles', data: profileData, overrideAccess: true })
    }

    if (input.communityRole) {
      const existingRole = await payload.find({
        collection: 'user-roles',
        where: { and: [{ user: { equals: user.id } }, { role: { equals: input.communityRole } }] },
        limit: 1,
        overrideAccess: true,
      })
      if (!existingRole.docs[0]) {
        await payload.create({
          collection: 'user-roles',
          data: { user: user.id, municipality: municipality.id, role: input.communityRole },
          overrideAccess: true,
        })
      }
    }

    const existingConsent = await payload.find({
      collection: 'consents',
      where: { and: [{ user: { equals: user.id } }, { type: { equals: 'platform_terms' } }] },
      limit: 1,
      overrideAccess: true,
    })
    if (!existingConsent.docs[0]) {
      await payload.create({
        collection: 'consents',
        data: { user: user.id, type: 'platform_terms', version: '1.0', grantedAt: new Date().toISOString() },
        overrideAccess: true,
      })
    }
  }

  await seedAccount({
    email: 'admin@admin.cz',
    password: 'admin1234',
    fullName: 'Admin obce',
    platformRole: 'admin',
    communityRole: 'municipality_admin',
  })

  await seedAccount({
    email: 'poradatel@poradatel.cz',
    password: 'poradatel1234',
    fullName: 'Pořadatel',
    platformRole: 'user',
    communityRole: 'organizer',
  })

  payload.logger.info('Seed complete.')
  process.exit(0)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
