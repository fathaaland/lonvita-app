import { NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/auth/app-url';
import { buildGoogleAuthorizeUrl, getGoogleCallbackUrl, isGoogleAuthConfigured, } from '@/lib/auth/google/provider';
import { OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_SECONDS, createOAuthState } from '@/lib/auth/google/state';
/**
 * Starts the Google sign-in: mints the CSRF state, drops it in a cookie, and hands the browser
 * to Google. `returnTo` rides along inside the cookie rather than in the URL, so it can't be
 * rewritten between here and the callback.
 */
export async function GET(request) {
    const appUrl = getAppUrl(request);
    if (!isGoogleAuthConfigured()) {
        return NextResponse.redirect(new URL('/auth?error=google-unavailable', appUrl));
    }
    const { searchParams } = new URL(request.url);
    const { state, cookieValue } = createOAuthState(searchParams.get('returnTo'));
    const response = NextResponse.redirect(buildGoogleAuthorizeUrl({ state, callbackUrl: getGoogleCallbackUrl(appUrl) }));
    response.cookies.set(OAUTH_STATE_COOKIE, cookieValue, {
        httpOnly: true,
        sameSite: 'lax', // Google's redirect back is a top-level GET — 'strict' would drop the cookie.
        secure: process.env.NODE_ENV === 'production',
        path: '/api/auth/google',
        maxAge: OAUTH_STATE_TTL_SECONDS,
    });
    return response;
}
