export const ensureProfile = async (payload, user, fullName, options = {}) => {
    const existing = await payload.find({
        collection: 'profiles',
        where: { user: { equals: user.id } },
        limit: 1,
        overrideAccess: true,
    });
    if (existing.docs[0])
        return;
    await payload.create({
        collection: 'profiles',
        data: {
            user: user.id,
            fullName: fullName?.trim() || user.email.split('@')[0],
            municipality: null,
            ...(options.onboardingCompleted ? { onboardingCompleted: true } : {}),
        },
        overrideAccess: true,
    });
};
/**
 * Find-or-create the Payload user for a given (already-verified) email.
 *
 * Unlike hbai-app's version, this does not assign a tenant/municipality — Lonvita users
 * pick their municipality explicitly when they create their Profile (registration flow),
 * not implicitly from their email domain or an SSO claim.
 */
export const upsertUser = async ({ payload, email, fullName }) => {
    const existing = await payload.find({
        collection: 'users',
        where: { email: { equals: email } },
        limit: 1,
        overrideAccess: true,
    });
    let user = existing.docs[0];
    if (!user) {
        try {
            user = await payload.create({
                collection: 'users',
                data: { email, role: 'user' },
                overrideAccess: true,
            });
        }
        catch (error) {
            // Race: another concurrent request created the same user between our find and create.
            const retry = await payload.find({
                collection: 'users',
                where: { email: { equals: email } },
                limit: 1,
                overrideAccess: true,
            });
            if (!retry.docs[0])
                throw error;
            user = retry.docs[0];
        }
    }
    await ensureProfile(payload, user, fullName);
    return user;
};
