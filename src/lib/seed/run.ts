import type { Payload } from 'payload'

const CATEGORIES = [
  { name: 'Sport', icon: 'Dumbbell', color: '#F97316' },
  { name: 'Kultura', icon: 'Music', color: '#8B5CF6' },
  { name: 'Vzdělávání', icon: 'BookOpen', color: '#3B82F6' },
  { name: 'Setkání', icon: 'Users', color: '#EC4899' },
  { name: 'Výlety', icon: 'Mountain', color: '#10B981' },
  { name: 'Zdraví', icon: 'Heart', color: '#EF4444' },
]

const SEED_USERS = [
  { email: 'superadmin@lonvita.cz', password: 'superadmin1234', platformRole: 'admin' as const },
  { email: 'admin@admin.cz', password: 'admin1234', platformRole: 'user' as const },
  { email: 'ucastnik@ucastnik.cz', password: 'ucastnik1234', platformRole: 'user' as const },
]

async function seedUser(
  payload: Payload,
  input: { email: string; password: string; platformRole: 'admin' | 'user' },
) {
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
}

export async function runSeed(payload: Payload) {
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

  for (const u of SEED_USERS) {
    await seedUser(payload, u)
  }

  payload.logger.info('Seed complete.')
}
