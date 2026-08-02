import { headers as getHeaders } from 'next/headers'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'

import { authenticateUser } from '@/lib/actions/auth/auth-user'
import { CURRENT_PATH_HEADER, getClearSessionPath } from '@/lib/auth/redirect'

/**
 * Server-side guard for React Server Components / server actions that need an
 * authenticated user. Redirects to the Auth0 session cleanup route (which then bounces
 * to /login) if no user is resolved.
 */
export const requireUser = async () => {
  await connection()

  const { user } = await authenticateUser()

  if (!user) {
    const headers = await getHeaders()
    redirect(getClearSessionPath(headers.get(CURRENT_PATH_HEADER)))
  }

  return user
}
