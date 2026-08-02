import { randomBytes } from 'node:crypto'

import type { CollectionAfterLogoutHook, CollectionBeforeValidateHook, CollectionConfig } from 'payload'

import { payloadTokenJwtStrategy } from './auth/strategies/payload-token-jwt'

// Real login always goes through Auth0 (database connection or Google). Payload's `auth`
// system still requires a hashable password to exist, so if none is supplied we generate
// a random one that is never known or used by anyone.
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

const clearAuth0SessionCookies: CollectionAfterLogoutHook = async () => {
  try {
    const { cookies } = await import('next/headers')
    const cookieStore = await cookies()

    for (const { name } of cookieStore.getAll()) {
      if (/^__session(__\d+)?$/.test(name)) {
        cookieStore.delete(name)
      }
    }
  } catch {
    // Not in a request scope (e.g. called from a script) — nothing to clear.
  }
}

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'role', 'updatedAt'],
  },
  auth: {
    tokenExpiration: 7200, // 2 hours
    verify: false, // Auth0 owns email verification (the `emailVerified` field on auth-identities).
    maxLoginAttempts: 5,
    lockTime: 600 * 1000, // 10 minutes
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
      admin: {
        position: 'sidebar',
        description: 'Platform-level role — controls Payload admin access, not community roles.',
      },
    },
  ],
  hooks: {
    beforeValidate: [setGeneratedPasswordIfMissing],
    afterLogout: [clearAuth0SessionCookies],
  },
  timestamps: true,
}
