import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getSafeRedirectPath } from '@/lib/auth/redirect';
/**
 * CSRF protection for the OAuth round trip, as a double-submit cookie: the same nonce goes to
 * Google as `state` and into an httpOnly cookie, and the callback only proceeds when the two
 * match. That ties the callback to the browser that started the flow, so someone else's
 * authorization code replayed against this app has nothing to match against.
 *
 * Deliberately stateless. A server-side store (a Map, or Redis) has to be shared across
 * instances and swept for expiry; a cookie the browser hands back is inherently per-browser,
 * expires on its own, and is single-use because the callback clears it.
 */
export const OAUTH_STATE_COOKIE = 'lonvita-oauth-state';
/** Scoped to the OAuth routes so the cookie never rides along with ordinary requests. Clearing
 * it has to name the same path — a browser ignores a deletion whose path doesn't match. */
export const OAUTH_STATE_COOKIE_PATH = '/api/auth/google';
const NONCE_BYTES = 32;
/** Long enough to sign in with (including a password prompt and 2FA), short enough that an
 * abandoned flow doesn't stay replayable. */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const encode = (value) => Buffer.from(value, 'utf8').toString('base64url');
const decode = (value) => Buffer.from(value, 'base64url').toString('utf8');
export const createOAuthState = (returnTo) => {
    const state = randomBytes(NONCE_BYTES).toString('base64url');
    // Validated on the way in as well as on the way out — a path that could never be redirected
    // to has no business being carried around in a cookie in the first place.
    const safeReturnTo = getSafeRedirectPath(returnTo, '/');
    return { state, cookieValue: `${state}.${encode(safeReturnTo)}` };
};
export const verifyOAuthState = (stateFromQuery, cookieValue) => {
    if (!stateFromQuery || !cookieValue)
        return { valid: false };
    const separator = cookieValue.indexOf('.');
    if (separator < 1)
        return { valid: false };
    const expected = cookieValue.slice(0, separator);
    const encodedReturnTo = cookieValue.slice(separator + 1);
    const a = Buffer.from(stateFromQuery);
    const b = Buffer.from(expected);
    // timingSafeEqual throws on a length mismatch, which would itself leak length — check first.
    if (a.length !== b.length || !timingSafeEqual(a, b))
        return { valid: false };
    let returnTo = '/';
    try {
        returnTo = getSafeRedirectPath(decode(encodedReturnTo), '/');
    }
    catch {
        returnTo = '/';
    }
    return { valid: true, returnTo };
};
