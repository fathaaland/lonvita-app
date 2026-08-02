import { getSafeRedirectPath } from '@/lib/auth/redirect'

const AUTH0_LOGOUT_PATH = '/auth/logout'

const getAppBaseUrl = () => {
  const baseUrl = process.env.AUTH0_BASE_URL || process.env.NEXT_PUBLIC_APP_URL
  return baseUrl?.replace(/\/+$/, '') || null
}

export const getAuth0LogoutPath = (returnTo?: string | null) => {
  const params = new URLSearchParams()
  const safeReturnTo = getSafeRedirectPath(returnTo, '/login')
  const appBaseUrl = getAppBaseUrl()

  if (safeReturnTo !== '/') {
    params.set('returnTo', appBaseUrl ? `${appBaseUrl}${safeReturnTo}` : safeReturnTo)
  }

  const query = params.toString()
  return query ? `${AUTH0_LOGOUT_PATH}?${query}` : AUTH0_LOGOUT_PATH
}
