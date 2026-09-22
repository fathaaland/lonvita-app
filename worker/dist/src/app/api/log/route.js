import { NextResponse } from 'next/server';
import { getPayload } from 'payload';
import { z } from 'zod';
import config from '@payload-config';
import { logger } from '@/lib/logger';
import { correlationIdFromHeaders } from '@/lib/logger/correlation';
import { consumeRateLimit, getClientIp } from '@/lib/security/rate-limit';
/** Everything here arrives from a browser that can send whatever it likes, so the body is
 * capped before parsing and every field is length-bounded after it. */
const MAX_BODY_BYTES = 16_000;
const MAX_TEXT = 5_000;
const reportSchema = z.object({
    event: z.string().min(1).max(200),
    level: z.enum(['warn', 'error']).optional(),
    message: z.string().max(MAX_TEXT),
    stack: z.string().max(MAX_TEXT).optional(),
    componentStack: z.string().max(MAX_TEXT).optional(),
    /** Next.js replaces the real message with this hash in production builds. */
    digest: z.string().max(200).optional(),
    url: z.string().max(2_000).optional(),
    correlationId: z.string().max(200).optional(),
});
/**
 * The message column of the log store should read as a sentence; the machine-readable name
 * travels in `event`. Unknown values still get through — a browser that reports something new
 * is worth seeing, just not worth trusting with the wording.
 */
const BROWSER_EVENT_LABEL = {
    render_error: 'Browser render error',
    global_error: 'Browser fatal render error',
    window_error: 'Browser uncaught error',
    unhandled_rejection: 'Browser unhandled promise rejection',
};
const SESSION_COOKIE = 'payload-token';
/** Attribution is a bonus, not a requirement: anonymous crashes on /auth are exactly the ones
 * worth seeing, so an unauthenticated report is still accepted. Payload is only touched when a
 * session cookie is actually present, to keep the cheap path cheap. */
const resolveReporter = async (request) => {
    if (!request.headers.get('cookie')?.includes(`${SESSION_COOKIE}=`))
        return null;
    try {
        const payload = await getPayload({ config });
        const { user } = await payload.auth({ headers: request.headers });
        return user ? { userId: user.id, userEmail: user.email, userRole: user.role } : null;
    }
    catch {
        return null;
    }
};
export async function POST(request) {
    const ip = getClientIp(request.headers);
    // A crash loop in a render can fire this on every re-render; the log budget shouldn't pay
    // for that, and neither should anyone who points a script at the endpoint.
    const rateLimit = await consumeRateLimit({
        namespace: 'client-log',
        identifier: ip,
        max: 30,
        windowSeconds: 60,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } });
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
        return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    let parsedBody;
    try {
        parsedBody = JSON.parse(raw);
    }
    catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const parsed = reportSchema.safeParse(parsedBody);
    if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const { event, level, message, stack, componentStack, digest, url, correlationId } = parsed.data;
    const reporter = await resolveReporter(request);
    logger[level ?? 'error'](BROWSER_EVENT_LABEL[event] ?? `Browser error (${event})`, {
        event: `client.${event}`,
        errorMessage: message,
        stack,
        componentStack,
        digest,
        url,
        userAgent: request.headers.get('user-agent')?.slice(0, 200),
        ip,
        ...reporter,
        // The browser quotes the id the page was served with; the header is the id of *this*
        // request, which is only a fallback when the cookie was missing.
        correlationId: correlationId || correlationIdFromHeaders(request.headers),
    });
    return new NextResponse(null, { status: 204 });
}
