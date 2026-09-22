import { Resend } from 'resend';
import { logger } from '@/lib/logger';
let resendClient = null;
function getResendClient() {
    if (!resendClient) {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
            throw new Error('RESEND_API_KEY is not set - cannot send email');
        }
        resendClient = new Resend(apiKey);
    }
    return resendClient;
}
function getFromAddress(from) {
    const resolved = from ?? process.env.RESEND_FROM_EMAIL;
    if (!resolved) {
        throw new Error('RESEND_FROM_EMAIL is not set - cannot determine sender');
    }
    return resolved;
}
function normalizeRecipients(to) {
    return Array.isArray(to) ? to : [to];
}
export const processEmailJob = async (payload, context) => {
    const { to, subject, body, replyTo, from } = payload;
    const recipients = normalizeRecipients(to);
    const fromAddress = getFromAddress(from);
    logger.info('E-mail send started', {
        event: 'email.send_started',
        jobId: context?.jobId,
        subject,
        to: recipients,
        from: fromAddress,
        attempt: (context?.attemptsMade ?? 0) + 1,
    });
    const resend = getResendClient();
    const { data, error } = await resend.emails.send({
        from: fromAddress,
        to: recipients,
        subject,
        html: body,
        ...(replyTo ? { reply_to: replyTo } : {}),
    });
    if (error) {
        // Carries `from` because the rejections that actually happen are about the sender: an
        // unverified domain, or a sandboxed account that may only write to its own owner.
        logger.error('E-mail send rejected', {
            event: 'email.send_rejected',
            jobId: context?.jobId,
            subject,
            to: recipients,
            from: fromAddress,
            providerError: error.message,
            providerErrorName: error.name,
        });
        throw new Error(`Resend error: ${error.message}`);
    }
    if (!data?.id) {
        logger.error('E-mail sent without a message ID', {
            event: 'email.send_without_message_id',
            jobId: context?.jobId,
            subject,
            to: recipients,
        });
        throw new Error('Resend returned no message ID - treating as failure');
    }
    logger.info('E-mail send succeeded', {
        event: 'email.send_succeeded',
        jobId: context?.jobId,
        subject,
        to: recipients,
        messageId: data.id,
    });
    return {
        messageId: data.id,
        accepted: recipients,
    };
};
