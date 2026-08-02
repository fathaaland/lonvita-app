import { ManagementClient } from 'auth0'

let cachedClient: ManagementClient | null = null

export const getManagementClient = (): ManagementClient => {
  if (cachedClient) return cachedClient

  const domain = process.env.AUTH0_M2M_DOMAIN
  const clientId = process.env.AUTH0_M2M_CLIENT_ID
  const clientSecret = process.env.AUTH0_M2M_CLIENT_SECRET

  if (!domain || !clientId || !clientSecret) {
    throw new Error(
      'Auth0 Management API is not configured. Missing one of: AUTH0_M2M_DOMAIN, AUTH0_M2M_CLIENT_ID, AUTH0_M2M_CLIENT_SECRET.',
    )
  }

  cachedClient = new ManagementClient({
    domain,
    clientId,
    clientSecret,
  })

  return cachedClient
}
