'use server';
import config from '@payload-config';
import { getPayload } from 'payload';
import { enqueueEmail } from '@/lib/queue/queues';
import { forgotPasswordInputSchema } from '@/lib/auth/password-reset-schema';
import { logger, serializeError } from '@/lib/logger';
import { correlationIdFromHeaders } from '@/lib/logger/correlation';
import { enforcePasswordResetRateLimit } from '@/lib/security/rate-limit';
const buildResetPasswordEmailHtml = (resetUrl) => `
  <p>Dostali jsme žádost o obnovení hesla k vašemu účtu na Lonvitě.</p>
  <p><a href="${resetUrl}" style="display:inline-block;padding:10px 20px;background:#5B3A8E;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Nastavit nové heslo</a></p>
  <p>Nebo otevřete tento odkaz: <a href="${resetUrl}">${resetUrl}</a></p>
  <p style="color:#666;font-size:13px;">Odkaz je platný 1 hodinu. Pokud jste o obnovení hesla nežádali, tento e-mail můžete ignorovat — vaše heslo zůstane beze změny.</p>
`;
/** Always resolves (never leaks whether the e-mail exists) — the caller shows the same
 * "check your inbox" message regardless. Sends via the BullMQ email queue (Resend). */
export async function forgotPasswordAction({ email, appUrl, requestHeaders }) {
    // Every branch below returns void so the response never reveals whether the account exists.
    // That silence is for the caller, not for us: the log records which branch was taken, or a
    // request that produced no e-mail is indistinguishable from one that worked.
    const correlationId = correlationIdFromHeaders(requestHeaders);
    const parsed = forgotPasswordInputSchema.safeParse({ email });
    if (!parsed.success) {
        logger.info('Forgot password rejected', {
            event: 'auth.forgot_password_rejected',
            reason: 'invalid_email',
            correlationId,
        });
        return;
    }
    const rateLimit = await enforcePasswordResetRateLimit({
        operation: 'forgot-password',
        requestHeaders,
        email: parsed.data.email,
    });
    if (!rateLimit.allowed) {
        logger.warn('Forgot password rejected', {
            event: 'auth.forgot_password_rejected',
            reason: 'rate_limited',
            userEmail: parsed.data.email,
            retryAfter: rateLimit.retryAfter,
            correlationId,
        });
        return;
    }
    const payload = await getPayload({ config });
    let token = null;
    try {
        token = await payload.forgotPassword({
            collection: 'users',
            overrideAccess: true,
            disableEmail: true,
            data: { email: parsed.data.email },
        });
    }
    catch (error) {
        // Expected for an address nobody registered — recorded at info because a sudden run of
        // these is how account enumeration looks from the inside.
        logger.info('Forgot password rejected', {
            event: 'auth.forgot_password_rejected',
            reason: 'no_matching_account',
            userEmail: parsed.data.email,
            ...serializeError(error),
            correlationId,
        });
        return;
    }
    if (!token) {
        logger.warn('Forgot password rejected', {
            event: 'auth.forgot_password_rejected',
            reason: 'no_token_issued',
            userEmail: parsed.data.email,
            correlationId,
        });
        return;
    }
    const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    try {
        const job = await enqueueEmail({
            to: parsed.data.email,
            subject: 'Obnovení hesla — Lonvita',
            body: buildResetPasswordEmailHtml(resetUrl),
        }, { correlationId });
        logger.info('Forgot password e-mail queued', {
            event: 'auth.forgot_password_email_queued',
            userEmail: parsed.data.email,
            jobId: job.id,
            correlationId,
        });
    }
    catch (error) {
        // The token is already minted at this point, so a queue outage leaves a user waiting for
        // an e-mail that will never come. This is the line that says so.
        logger.error('Forgot password e-mail enqueue failed', {
            event: 'auth.forgot_password_email_enqueue_failed',
            userEmail: parsed.data.email,
            ...serializeError(error),
            correlationId,
        });
        throw error;
    }
}
