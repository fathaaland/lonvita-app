export const CURRENT_PATH_HEADER = 'x-current-path'

/** Only ever allow same-origin relative paths — guards against open-redirect via query params. */
export const getSafeRedirectPath = (path: string | null | undefined, fallback: string): string => {
  if (!path) return fallback
  if (!path.startsWith('/') || path.startsWith('//')) return fallback

  try {
    new URL(path, 'http://localhost')
  } catch {
    return fallback
  }

  return path
}

export const getClearSessionPath = (redirectPath?: string | null, error?: string | null): string => {
  const params = new URLSearchParams()
  const safePath = getSafeRedirectPath(redirectPath, '/')

  if (safePath !== '/') {
    params.set('redirect', safePath)
  }

  if (error) {
    params.set('error', error)
  }

  const query = params.toString()
  return query ? `/api/auth/clear-session?${query}` : '/api/auth/clear-session'
}
