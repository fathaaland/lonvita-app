/**
 * Right-to-erasure (GDPR) works by pseudonymizing the personal identifiers on a row, not by
 * deleting it — participation/attendance history must survive so Datavita and grant reporting
 * stay accurate (brief §A3). This field marks a row as withdrawn without removing it; pair it
 * with `access.delete: adminOnly` and a `deletedAt: { exists: false }` read filter so normal
 * app code can never bypass the pattern with a hard DELETE.
 */
export const deletedAtField = {
    name: 'deletedAt',
    type: 'date',
    admin: {
        description: 'Soft-delete marker — preserves history for reporting. Set by admin action, not user-facing delete.',
        position: 'sidebar',
    },
};
export const adminOnlyDelete = ({ req: { user } }) => user?.role === 'admin';
export const notDeleted = { deletedAt: { exists: false } };
