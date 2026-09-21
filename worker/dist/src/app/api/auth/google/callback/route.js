import { NextResponse } from 'next/server';
import { getPayload } from 'payload';
import config from '@payload-config';
import { getAppUrl } from '@/lib/auth/app-url';
import { resolveGoogleUser } from '@/lib/auth/google/link-account';
import { exchangeCodeForAccessToken, fetchGoogleProfile, getGoogleCallbackUrl, isGoogleAuthConfigured, } from '@/lib/auth/google/provider';
import { OAUTH_STATE_COOKIE, OAUTH_STATE_COOKIE_PATH, verifyOAuthState } from '@/lib/auth/google/state';
import { buildPayloadTokenCookie } from '@/lib/auth/session-cookie';
import { logger, serializeError } from '@/lib/logger';
import { correlationIdFromHeaders } from '@/lib/logger/correlation';
const failTo = (appUrl, error) => {
    const response = NextResponse.redirect(new URL(`/auth?error=${error}`, appUrl));
    clearStateCookie(response);
    return response;
};
/** The flow is over either way — don't leave a state cookie lying around to be replayed.
 *
 * Appends a raw header rather than going through `response.cookies`: that API re-serialises the
 * whole Set-Cookie set from its own store, and on a NextResponse whose cookies were never touched
 * the store starts out empty — so it silently dropped the session cookie appended just above,
 * and the Google sign-in landed back on /auth with no session at all. */
function clearStateCookie(response) {
    response.headers.append('Set-Cookie', `${OAUTH_STATE_COOKIE}=; Path=${OAUTH_STATE_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0`);
}
export async function GET(request) {
    // Every early return below sends the user to /auth with an opaque code, which is right for
    // them and useless for us — so each one says here which of the six ways it failed.
    const correlationId = correlationIdFromHeaders(request.headers);
    const fail = (appUrl, error, reason, context) => {
        logger.warn('auth.google_sign_in_failed', {
            event: 'auth.google_sign_in_failed',
            reason,
            error,
            ...context,
            correlationId,
        });
        return failTo(appUrl, error);
    };
    const appUrl = getAppUrl(request);
    if (!isGoogleAuthConfigured()) {
        return fail(appUrl, 'google-unavailable', 'provider_not_configured');
    }
    const { searchParams } = new URL(request.url);
    // Google reports a user who cancelled with ?error=access_denied — that's not a failure worth
    // an error banner, they just changed their mind.
    const providerError = searchParams.get('error');
    if (providerError) {
        logger.info('auth.google_sign_in_abandoned', {
            event: 'auth.google_sign_in_abandoned',
            providerError,
            correlationId,
        });
        const response = NextResponse.redirect(new URL('/auth', appUrl));
        clearStateCookie(response);
        return response;
    }
    const stateCookie = request.headers
        .get('cookie')
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${OAUTH_STATE_COOKIE}=`))
        ?.slice(OAUTH_STATE_COOKIE.length + 1);
    const verified = verifyOAuthState(searchParams.get('state'), stateCookie);
    if (!verified.valid) {
        return fail(appUrl, 'google-failed', 'state_mismatch', { hadStateCookie: Boolean(stateCookie) });
    }
    const code = searchParams.get('code');
    if (!code)
        return fail(appUrl, 'google-failed', 'missing_authorization_code');
    const payload = await getPayload({ config });
    try {
        const accessToken = await exchangeCodeForAccessToken(code, getGoogleCallbackUrl(appUrl));
        const profile = await fetchGoogleProfile(accessToken);
        if (!profile.providerSubject)
            return fail(appUrl, 'google-failed', 'profile_without_subject');
        const result = await resolveGoogleUser(payload, profile);
        if (!result.ok) {
            return fail(appUrl, result.reason === 'no-email' ? 'google-no-email' : 'google-email-unverified', `profile_${result.reason}`);
        }
        // Someone who hasn't finished onboarding goes there rather than to wherever they were
        // headed — the same rule the password sign-in follows.
        const profiles = await payload.find({
            collection: 'profiles',
            where: { user: { equals: result.user.id } },
            depth: 0,
            limit: 1,
            overrideAccess: true,
        });
        const destination = profiles.docs[0]?.onboardingCompleted ? verified.returnTo : '/onboarding';
        const response = NextResponse.redirect(new URL(destination, appUrl));
        response.headers.append('Set-Cookie', await buildPayloadTokenCookie(payload, result.user));
        clearStateCookie(response);
        logger.info('auth.google_sign_in_succeeded', {
            event: 'auth.google_sign_in_succeeded',
            userId: result.user.id,
            userEmail: result.user.email,
            destination,
            correlationId,
        });
        return response;
    }
    catch (error) {
        // Where a redirect_uri_mismatch or a revoked client secret surfaces — the message from
        // Google is the whole diagnosis, and until now it only existed in the platform log.
        logger.error('auth.google_sign_in_error', {
            event: 'auth.google_sign_in_error',
            callbackUrl: getGoogleCallbackUrl(appUrl),
            ...serializeError(error),
            correlationId,
        });
        return failTo(appUrl, 'google-failed');
    }
}
