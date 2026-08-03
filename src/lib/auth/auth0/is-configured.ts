/**
 * Whether a real Auth0 tenant is wired up. When any of these are unset, the app falls
 * back to Payload's own built-in local (email/password) auth strategy instead — see
 * src/app/api/auth/register/route.ts and src/app/(frontend)/auth/page.tsx.
 */
export const isAuth0Configured = (): boolean =>
  Boolean(
    process.env.AUTH0_DOMAIN &&
      process.env.AUTH0_CLIENT_ID &&
      process.env.AUTH0_SECRET &&
      process.env.AUTH0_CLIENT_SECRET,
  )
