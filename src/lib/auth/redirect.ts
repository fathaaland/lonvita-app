export const CURRENT_PATH_HEADER = 'x-current-path'

/**
 * Only ever allow same-origin relative paths — guards against open-redirect via query params.
 *
 * The prefix check alone isn't enough: browsers read a backslash as a slash, so `/\evil.com`
 * passes it and still lands on `//evil.com`. Resolving the path against a throwaway origin and
 * insisting it stays there catches that and every other spelling of "another host".
 */
export const getSafeRedirectPath = (path: string | null | undefined, fallback: string): string => {
  if (!path) return fallback
  if (!path.startsWith('/') || path.startsWith('//')) return fallback

  try {
    const base = new URL('http://internal.invalid')
    const resolved = new URL(path, base)
    if (resolved.origin !== base.origin || resolved.pathname.startsWith('//')) return fallback

    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  } catch {
    return fallback
  }
}
