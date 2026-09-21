import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { logger, serializeError } from '@/lib/logger';
const PASSWORD_RESET_ACTION_LIMIT = {
    max: 5,
    windowSeconds: 15 * 60,
};
const MAX_CLIENT_IP_LENGTH = 256;
let redis;
const getRedis = () => {
    if (redis !== undefined)
        return redis;
    if (process.env.REDIS_URL) {
        const client = new Redis(process.env.REDIS_URL, {
            retryStrategy: (times) => Math.min(times * 50, 2000),
        });
        client.on('error', () => undefined);
        redis = client;
    }
    else {
        redis = null;
    }
    return redis;
};
const hashIdentifier = (identifier) => createHash('sha256').update(identifier).digest('hex');
export const getClientIp = (requestHeaders) => {
    const forwardedFor = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim();
    return (forwardedFor || requestHeaders.get('x-real-ip')?.trim() || 'unknown').slice(0, MAX_CLIENT_IP_LENGTH);
};
export const consumeRateLimit = async ({ namespace, identifier, max, windowSeconds, store = getRedis(), }) => {
    const retryAfter = windowSeconds;
    if (!store) {
        return { allowed: true, retryAfter };
    }
    const key = `ratelimit:${namespace}:${hashIdentifier(identifier)}`;
    try {
        const count = await store.incr(key);
        if (count === 1) {
            await store.expire(key, windowSeconds);
        }
        if (count <= max) {
            return { allowed: true, retryAfter };
        }
        const ttl = await store.ttl(key);
        logger.warn('security.rate_limit_exceeded', {
            event: 'security.rate_limit_exceeded',
            namespace,
            max,
            windowSeconds,
            count,
        });
        return {
            allowed: false,
            retryAfter: ttl > 0 ? ttl : retryAfter,
        };
    }
    catch (error) {
        // Keep authentication usable when the optional rate-limit backend is unavailable. This
        // fails *open*, so it has to be loud: until it shows up in the log, the app silently has
        // no rate limiting at all.
        logger.error('security.rate_limit_backend_unavailable', {
            event: 'security.rate_limit_backend_unavailable',
            namespace,
            ...serializeError(error),
        });
        return { allowed: true, retryAfter };
    }
};
export const enforcePasswordResetRateLimit = async ({ operation, requestHeaders, email, }) => {
    const identifiers = [
        {
            namespace: `password-reset-action:${operation}:ip`,
            value: getClientIp(requestHeaders),
        },
    ];
    if (operation === 'forgot-password' && email) {
        identifiers.push({
            namespace: `password-reset-action:${operation}:email`,
            value: email,
        });
    }
    const results = await Promise.all(identifiers.map(({ namespace, value }) => consumeRateLimit({
        namespace,
        identifier: value,
        ...PASSWORD_RESET_ACTION_LIMIT,
    })));
    const blocked = results.filter((result) => !result.allowed);
    if (blocked.length === 0) {
        return { allowed: true, retryAfter: PASSWORD_RESET_ACTION_LIMIT.windowSeconds };
    }
    return {
        allowed: false,
        retryAfter: Math.max(...blocked.map((result) => result.retryAfter)),
    };
};
