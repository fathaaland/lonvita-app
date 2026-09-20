import { getManagementClient } from './client/management-client'

export class Auth0ManagementError extends Error {
  status?: number
  code?: string

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message)
    this.name = 'Auth0ManagementError'
    this.status = options?.status
    this.code = options?.code
  }
}

export const getAuth0DatabaseConnection = (): string => {
  const connection = process.env.AUTH0_USER_DATABASE_CONNECTION
  if (!connection) {
    throw new Error('Missing AUTH0_USER_DATABASE_CONNECTION env var.')
  }
  return connection
}

type CreateAuth0UserInput = {
  email: string
  password: string
  fullName: string
}

export const createAuth0DatabaseUser = async ({ email, password, fullName }: CreateAuth0UserInput) => {
  const managementClient = getManagementClient()
  const connection = getAuth0DatabaseConnection()

  try {
    const { data } = await managementClient.users.create({
      connection,
      email,
      password,
      name: fullName,
      verify_email: false,
      email_verified: false,
    })

    return data
  } catch (error) {
    const err = error as { statusCode?: number; message?: string; error?: string }
    throw new Auth0ManagementError(err.message ?? 'Failed to create Auth0 user.', {
      status: err.statusCode,
      code: err.error,
    })
  }
}

/** Keeps the Auth0-held credential in sync when a user resets their password through our own
 * (Resend-based) flow — Auth0 owns the actual login check for database-connection users, so
 * without this the reset would silently not let them log back in. */
export const updateAuth0UserPassword = async (auth0UserId: string, password: string): Promise<void> => {
  const managementClient = getManagementClient()

  try {
    await managementClient.users.update(auth0UserId, { password })
  } catch (error) {
    const err = error as { statusCode?: number; message?: string; error?: string }
    throw new Auth0ManagementError(err.message ?? 'Failed to update Auth0 user password.', {
      status: err.statusCode,
      code: err.error,
    })
  }
}

export const deleteAuth0User = async (auth0UserId: string): Promise<void> => {
  const managementClient = getManagementClient()

  try {
    await managementClient.users.delete(auth0UserId)
  } catch (error) {
    const err = error as { statusCode?: number }
    // Tolerate "already gone" during rollback — nothing left to clean up.
    if (err.statusCode === 404) return
    throw error
  }
}
