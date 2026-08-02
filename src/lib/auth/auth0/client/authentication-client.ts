import { AuthenticationClient } from 'auth0'

let cachedClient: AuthenticationClient | null = null

export const getAuthenticationClient = (): AuthenticationClient => {
  if (cachedClient) return cachedClient

  const domain = process.env.AUTH0_DOMAIN
  const clientId = process.env.AUTH0_CLIENT_ID

  if (!domain || !clientId) {
    throw new Error('Auth0 Authentication API is not configured. Missing AUTH0_DOMAIN or AUTH0_CLIENT_ID.')
  }

  cachedClient = new AuthenticationClient({
    domain,
    clientId,
  })

  return cachedClient
}
