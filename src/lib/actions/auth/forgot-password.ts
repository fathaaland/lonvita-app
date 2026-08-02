'use server'

import { getAuthenticationClient } from '@/lib/auth/auth0/client/authentication-client'

type ForgotPasswordInput = {
  email: string
}

export async function forgotPasswordAction({ email }: ForgotPasswordInput) {
  const auth0Auth = getAuthenticationClient()

  try {
    await auth0Auth.database.changePassword({
      email: email.toLowerCase(),
      connection: process.env.AUTH0_USER_DATABASE_CONNECTION!,
    })
  } catch {
    throw new Error('Failed to trigger Auth0 password reset email.')
  }
}
