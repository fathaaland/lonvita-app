import { logger } from '@/lib/logger';
import { correlationIdFromHeaders } from '@/lib/logger/correlation';
/**
 * Auth is where an incident starts, so these lines carry more than the CRUD trail does: the
 * source address, so a burst of failures against one account is recognisable, and the e-mail,
 * so "who" does not require a second lookup. Failed logins are not hookable in Payload — they
 * throw, and the global afterError hook in payload.config records them instead.
 */
const authContext = (req) => ({
    correlationId: correlationIdFromHeaders(req?.headers),
    ip: req?.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
    userAgent: req?.headers?.get?.('user-agent')?.slice(0, 200) ?? undefined,
});
export const logLoginSuccess = ({ req, user }) => {
    const account = user;
    logger.info('auth.login_success', {
        event: 'auth.login_success',
        userId: account?.id,
        userEmail: account?.email,
        userRole: account?.role,
        ...authContext(req),
    });
};
export const logLogout = ({ req }) => {
    const account = req?.user;
    logger.info('auth.logout', {
        event: 'auth.logout',
        userId: account?.id,
        userEmail: account?.email,
        ...authContext(req),
    });
};
export const logForgotPasswordIssued = ({ args }) => {
    const email = args?.data?.email;
    logger.info('auth.forgot_password_token_issued', {
        event: 'auth.forgot_password_token_issued',
        userEmail: email,
        correlationId: correlationIdFromHeaders(args?.req?.headers),
    });
};
