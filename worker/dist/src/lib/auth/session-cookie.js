import { SignJWT } from 'jose';
/**
 * Mints the same `payload-token` cookie Payload's own login issues, for sign-ins where there is
 * no password to check — the identity came from an OAuth provider instead.
 *
 * `payload.login()` can't be used for those: it always verifies a password, and an OAuth account
 * only has a random placeholder it will never match. Signing the token here is the same thing
 * Payload does internally, against the same secret, so the resulting cookie is indistinguishable
 * from a password login's and is read by the ordinary auth strategy.
 */
export async function buildPayloadTokenCookie(payload, user) {
    const collectionConfig = payload.collections['users']?.config;
    const tokenExpiration = collectionConfig?.auth?.tokenExpiration ?? 7200;
    const issuedAt = Math.floor(Date.now() / 1000);
    // `payload.secret` is already the sha256-derived key Payload verifies with — not the raw
    // PAYLOAD_SECRET env value.
    const token = await new SignJWT({ id: user.id, collection: 'users', email: user.email })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + tokenExpiration)
        .sign(new TextEncoder().encode(payload.secret));
    const cookieName = `${payload.config.cookiePrefix ?? 'payload'}-token`;
    return [
        `${cookieName}=${token}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${tokenExpiration}`,
        process.env.NODE_ENV === 'production' ? 'Secure' : '',
    ]
        .filter(Boolean)
        .join('; ');
}
