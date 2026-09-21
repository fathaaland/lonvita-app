import { upsertUser } from '@/lib/auth/users';
export async function resolveGoogleUser(payload, profile) {
    const existing = await payload.find({
        collection: 'auth-identities',
        where: { and: [{ provider: { equals: 'google' } }, { providerSubject: { equals: profile.providerSubject } }] },
        depth: 0,
        limit: 1,
        overrideAccess: true,
    });
    const identity = existing.docs[0];
    if (identity) {
        const userId = typeof identity.user === 'object' ? identity.user.id : identity.user;
        const user = await payload.findByID({ collection: 'users', id: userId, overrideAccess: true });
        await payload.update({
            collection: 'auth-identities',
            id: identity.id,
            data: {
                email: profile.email,
                emailVerified: profile.emailVerified,
                lastLoginAt: new Date().toISOString(),
                lastSyncedAt: new Date().toISOString(),
            },
            overrideAccess: true,
        });
        return { ok: true, user, linked: false };
    }
    if (!profile.email)
        return { ok: false, reason: 'no-email' };
    if (!profile.emailVerified)
        return { ok: false, reason: 'email-unverified' };
    // Whether this is a link or a fresh sign-up has to be read before the upsert, not inferred
    // from the row afterwards.
    const byEmail = await payload.find({
        collection: 'users',
        where: { email: { equals: profile.email } },
        depth: 0,
        limit: 1,
        overrideAccess: true,
    });
    const linkedToExistingAccount = byEmail.docs.length > 0;
    // Find-or-create by address, profile row included — the same path every other sign-up uses.
    const user = await upsertUser({ payload, email: profile.email, fullName: profile.fullName ?? undefined });
    await payload.create({
        collection: 'auth-identities',
        data: {
            user: user.id,
            provider: 'google',
            providerSubject: profile.providerSubject,
            providerType: 'social',
            email: profile.email,
            emailVerified: profile.emailVerified,
            lastLoginAt: new Date().toISOString(),
            lastSyncedAt: new Date().toISOString(),
        },
        overrideAccess: true,
    });
    return { ok: true, user, linked: linkedToExistingAccount };
}
