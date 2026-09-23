import { randomBytes } from 'node:crypto'

import type {
  CollectionBeforeDeleteHook,
  CollectionBeforeOperationHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
  CollectionSlug,
} from 'payload'
import { APIError } from 'payload'

import { logForgotPasswordIssued, logLoginSuccess, logLogout } from '@/lib/logger/auth-logger'

import { payloadTokenJwtStrategy } from './auth/strategies/payload-token-jwt'

// An account created by a Google sign-in has no password of its own, but Payload's `auth`
// system still requires a hashable one to exist — so generate a random one nobody will ever
// know or use. Those accounts sign in through the OAuth callback, never through this hash.
const setGeneratedPasswordIfMissing: CollectionBeforeValidateHook = ({ data, operation }) => {
  if (operation !== 'create') return data

  const userData = (data ?? {}) as Record<string, unknown>

  if (typeof userData.password === 'string' && userData.password.length > 0) {
    return userData
  }

  return {
    ...userData,
    password: randomBytes(32).toString('hex'),
  }
}

/**
 * The platform role is not something any API caller may hand out — not even a superadmin
 * granting it to someone else. `role` is locked by the field's own `access.update` below, which
 * is what actually enforces it; Payload drops the field silently there, though, so this runs
 * first (beforeOperation precedes every field pass) purely to answer with a real error instead
 * of a 200 that quietly changed nothing.
 *
 * Mirrors field access exactly, so neither is stricter than the other: only when access control
 * is being applied at all (`overrideAccess: false`, i.e. every request through the REST API).
 * Seeds and scripts on the Local API stay the one way to grant the role.
 */
const lockPlatformRole: CollectionBeforeOperationHook = async ({ args, operation, req }) => {
  if (operation !== 'update') return args

  const { data, id, overrideAccess } = args as {
    data?: { role?: unknown }
    id?: number | string
    overrideAccess?: boolean
  }
  // No id = a bulk update by `where`; field access still strips `role` there, there's just no
  // single document to compare against for the error message.
  if (overrideAccess !== false || data?.role === undefined || id === undefined) return args

  const current = await req.payload.findByID({
    collection: 'users',
    id,
    depth: 0,
    overrideAccess: true,
    req,
  })
  if (current.role !== data.role) {
    throw new APIError('Platformní roli uživatele nelze měnit přes aplikaci.', 403)
  }

  return args
}

/** Collections holding a row that points at a user through a NOT NULL column, in the order they
 * have to go. Every FK to `users` here is `ON DELETE set null`, so each of these rows turns a
 * user DELETE into a not-null violation unless it's removed first — which is why deleting an
 * account provisioned from the superadmin panel (user + profile + participant role) always
 * failed. Event feedback hangs off a registration, so it's handled separately, before this. */
const USER_OWNED_COLLECTIONS: { collection: CollectionSlug; field: string }[] = [
  { collection: 'registrations', field: 'user' },
  { collection: 'event-media', field: 'uploadedBy' },
  { collection: 'volunteer-flag-requests', field: 'requestedBy' },
  { collection: 'organizer-requests', field: 'user' },
  { collection: 'organizations', field: 'owner' },
  { collection: 'notifications', field: 'user' },
  { collection: 'consents', field: 'user' },
  { collection: 'auth-identities', field: 'user' },
  { collection: 'user-roles', field: 'user' },
  { collection: 'profiles', field: 'user' },
]

const cleanupUserRelations: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const { payload } = req

  // Events are the one thing that can't just be swept up with the account: `organizer` is NOT
  // NULL, and the event carries registrations, photos and reporting history that has to outlive
  // any single person. Say so in a way the panel can show, instead of failing on a DB constraint.
  const organized = await payload.count({
    collection: 'events',
    where: { organizer: { equals: id } },
    overrideAccess: true,
    req,
  })
  if (organized.totalDocs > 0) {
    throw new APIError(
      `Uživatel je pořadatelem ${organized.totalDocs} akcí. Nejdřív je zrušte nebo předejte jinému pořadateli, potom půjde účet smazat.`,
      400,
    )
  }

  const registrations = await payload.find({
    collection: 'registrations',
    where: { user: { equals: id } },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  if (registrations.docs.length > 0) {
    await payload.delete({
      collection: 'event-feedback',
      where: { registration: { in: registrations.docs.map((doc) => doc.id) } },
      overrideAccess: true,
      req,
    })
  }

  // Sequential, not Promise.all — they share one transaction (`req`), and user-roles' own
  // afterDelete writes back to municipalities while it runs.
  for (const { collection, field } of USER_OWNED_COLLECTIONS) {
    await payload.delete({
      collection,
      where: { [field]: { equals: id } },
      overrideAccess: true,
      req,
    })
  }
}

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'role', 'updatedAt'],
  },
  access: {
    // Real account creation always goes through /api/auth/register (overrideAccess: true).
    // No client should ever be able to hit Payload's built-in REST create directly.
    create: () => false,
    read: ({ req: { user } }) => {
      if (!user) return false
      if (user.role === 'admin') return true
      return { id: { equals: user.id } }
    },
    // Only a platform superadmin may edit a user's record. `role` itself is off-limits to
    // everyone over the API — see the field's own access below.
    update: ({ req: { user } }) => user?.role === 'admin',
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  auth: {
    tokenExpiration: 7200, // 2 hours
    verify: false, // The provider verifies the address (auth-identities.emailVerified).
    maxLoginAttempts: 5,
    lockTime: 600 * 1000, // 10 minutes
    // The reset e-mail promises one hour; spelled out so it can't drift with Payload's default.
    forgotPassword: { expiration: 60 * 60 * 1000 },
    strategies: [payloadTokenJwtStrategy],
  },
  fields: [
    // email is added automatically by Payload auth
    {
      name: 'role',
      type: 'select',
      label: 'Role',
      defaultValue: 'user',
      required: true,
      saveToJWT: true,
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'User', value: 'user' },
      ],
      // A superadmin handing platform rights to someone else is deliberately not a thing the
      // app can do — the superadmin panel has no control for it, and this makes sure no REST
      // call can either. Seeding the first superadmin runs with `overrideAccess: true`, which
      // skips field access, so bootstrapping is unaffected.
      access: { update: () => false },
      admin: {
        position: 'sidebar',
        description:
          'Platform-level role — controls Payload admin access, not community roles. Not editable through the app: grant it from a seed/script (Local API) only.',
      },
    },
  ],
  hooks: {
    beforeOperation: [lockPlatformRole],
    beforeValidate: [setGeneratedPasswordIfMissing],
    beforeDelete: [cleanupUserRelations],
    afterLogin: [logLoginSuccess],
    afterLogout: [logLogout],
    afterForgotPassword: [logForgotPasswordIssued],
  },
  timestamps: true,
}
