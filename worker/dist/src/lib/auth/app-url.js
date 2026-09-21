/** The app's own base URL for building absolute redirect targets. Prefers the configured
 * NEXT_PUBLIC_APP_URL (which must match the redirect URI registered at Google), but a Route Handler always
 * has the incoming request too — falling back to its origin means these routes don't 500
 * if the env var is missing from a particular deployment's build. */
export const getAppUrl = (request) => process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
