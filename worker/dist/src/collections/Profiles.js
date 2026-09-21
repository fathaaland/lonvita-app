import { isLoggedIn } from './access/shared';
import { deletedAtField, adminOnlyDelete, notDeleted } from './shared/softDelete';
import { sendNotification } from './shared/notify';
/** Brief §7 "Přihlášení do poolu dobrovolníků → účastník" — confirms once `isVolunteer`
 * flips false -> true (joining), not on every profile save. */
const notifyOnVolunteerSignup = async ({ doc, previousDoc, operation, req }) => {
    if (operation !== 'update')
        return doc;
    if (!doc.isVolunteer || previousDoc?.isVolunteer)
        return doc;
    sendNotification(req.payload, {
        userId: typeof doc.user === 'object' ? doc.user.id : doc.user,
        title: 'Přihlášení do poolu dobrovolníků',
        message: 'Jste přihlášeni do poolu dobrovolníků vaší obce. Organizátoři dobrovolnických akcí vás teď mohou oslovit.',
        email: {
            subject: 'Přihlášení do poolu dobrovolníků',
            body: '<p>Jste přihlášeni do poolu dobrovolníků vaší obce. Organizátoři dobrovolnických akcí vás teď mohou oslovit.</p>',
        },
    });
    return doc;
};
export const Profiles = {
    slug: 'profiles',
    labels: {
        singular: 'Profile',
        plural: 'Profiles',
    },
    admin: {
        useAsTitle: 'fullName',
        defaultColumns: ['fullName', 'municipality', 'updatedAt'],
    },
    access: {
        read: ({ req: { user } }) => (user ? notDeleted : false),
        create: isLoggedIn,
        update: ({ req: { user } }) => {
            if (!user)
                return false;
            // A platform superadmin edits other people's profiles from the "Uživatelé" tab
            // (the pencil next to each account); everyone else may only touch their own.
            if (user.role === 'admin')
                return true;
            return { user: { equals: user.id } };
        },
        delete: adminOnlyDelete,
    },
    fields: [
        {
            name: 'user',
            type: 'relationship',
            relationTo: 'users',
            required: true,
            unique: true,
            admin: {
                description: '1:1 link to the account this profile belongs to.',
            },
        },
        {
            name: 'fullName',
            type: 'text',
            required: true,
        },
        {
            name: 'municipality',
            type: 'relationship',
            relationTo: 'municipalities',
            admin: {
                description: 'The user\'s home municipality. Empty = "bez obce" (their town doesn\'t use Lonvita yet) — they browse and can register for events across every municipality.',
            },
        },
        {
            name: 'phone',
            type: 'text',
        },
        {
            name: 'phoneVerified',
            type: 'checkbox',
            defaultValue: false,
            admin: {
                description: 'Brief §8 "přidání a ověření tel. čísla pro GoSMS" — set once an OTP sent to `phone` is confirmed.',
                position: 'sidebar',
            },
        },
        {
            name: 'notifyEmail',
            type: 'checkbox',
            defaultValue: true,
            admin: {
                description: 'Brief §7 "Preferovaný kanál notifikací... e-mail defaultně."',
            },
        },
        {
            name: 'notifyInApp',
            type: 'checkbox',
            defaultValue: true,
            admin: {
                description: 'Brief §7 "...aplikace volitelně."',
            },
        },
        {
            name: 'dateOfBirth',
            type: 'date',
        },
        {
            name: 'gender',
            type: 'select',
            options: [
                { label: 'Žena', value: 'zena' },
                { label: 'Muž', value: 'muz' },
                { label: 'Jiné', value: 'jine' },
                { label: 'Neuvedeno', value: 'neuvedeno' },
            ],
        },
        {
            name: 'interests',
            type: 'relationship',
            relationTo: 'event-categories',
            hasMany: true,
        },
        {
            name: 'homeArea',
            type: 'relationship',
            relationTo: 'municipality-areas',
            admin: {
                description: 'Neighborhood within the municipality, chosen during onboarding.',
            },
        },
        {
            name: 'onboardingCompleted',
            type: 'checkbox',
            defaultValue: false,
        },
        {
            name: 'isVolunteer',
            type: 'checkbox',
            defaultValue: false,
        },
        {
            name: 'volunteerFocus',
            type: 'text',
            hasMany: true,
        },
        {
            name: 'volunteerNote',
            type: 'textarea',
        },
        {
            name: 'volunteerSince',
            type: 'date',
        },
        deletedAtField,
    ],
    hooks: {
        afterChange: [notifyOnVolunteerSignup],
    },
    timestamps: true,
};
