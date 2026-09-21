import { createHash } from 'node:crypto';
const authenticateViaPayloadToken = async ({ headers, payload }) => {
    const cookieHeader = headers.get('cookie');
    if (!cookieHeader)
        return null;
    const cookies = new Map();
    cookieHeader.split(';').forEach((c) => {
        const [name, ...rest] = c.trim().split('=');
        if (name)
            cookies.set(name, decodeURI(rest.join('=')));
    });
    const tokenCookieName = `${payload.config.cookiePrefix}-token`;
    const token = cookies.get(tokenCookieName);
    if (!token)
        return null;
    try {
        const { jwtVerify } = await import('jose');
        // Payload hashes config.secret with SHA-256, truncated to 32 hex chars.
        const hashedSecret = createHash('sha256')
            .update(process.env.PAYLOAD_SECRET)
            .digest('hex')
            .slice(0, 32);
        const secretKey = new TextEncoder().encode(hashedSecret);
        const { payload: decoded } = await jwtVerify(token, secretKey);
        const user = await payload.findByID({
            id: decoded.id,
            collection: decoded.collection,
            overrideAccess: true,
        });
        if (!user)
            return null;
        const u = user;
        u.collection = decoded.collection;
        u._strategy = 'payload-token-jwt';
        return user;
    }
    catch {
        return null;
    }
};
export const payloadTokenJwtStrategy = {
    name: 'payload-token-jwt',
    authenticate: async (args) => {
        // The one way in: the payload-token cookie, whether it came from a password login or from
        // the Google callback minting the very same token.
        return { user: await authenticateViaPayloadToken(args) };
    },
};
