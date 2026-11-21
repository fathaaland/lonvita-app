/**
 * The circles of notifications a participant can tell apart. Every one goes into the app always;
 * only the e-mail is the user's choice per circle (Profiles.emailMuted — what they switched off, so
 * a circle added later is on for everyone). A `locked` circle is e-mailed whatever they chose: what
 * they must not miss, or what the platform is bound to tell them.
 *
 * Every `sendNotification*` names its circle — a new notification can't be written without placing it.
 */
export const NOTIFICATION_CATEGORIES = [
  {
    key: 'event_changes',
    label: 'Zrušení a změny akcí',
    description: 'Akce, na kterou jste přihlášeni, se ruší nebo mění.',
    locked: true,
  },
  {
    key: 'organizer_message',
    label: 'Zprávy od pořadatele',
    description: 'Vzkaz pořadatele účastníkům akce.',
    locked: true,
  },
  {
    key: 'my_registrations',
    label: 'Moje přihlášky',
    description: 'Potvrzení a schválení přihlášky, připomínky před akcí, žádost o hodnocení.',
    locked: false,
  },
  {
    key: 'volunteering',
    label: 'Dobrovolnictví',
    description: 'Nabídky a pozvánky k pomoci na akcích, pozvánky do poolu dobrovolníků.',
    locked: false,
  },
  {
    key: 'my_events',
    label: 'Moje akce a spolupořadatelé',
    description: 'Nové přihlášky a odhlášky, změny týmu, spolupořadatelství a žádosti o smazání akce.',
    locked: false,
  },
  {
    key: 'my_requests',
    label: 'Role, přístupy a moje žádosti',
    description: 'Vyřízení vaší žádosti o roli, přístup k dobrovolníkům nebo stížnosti.',
    locked: false,
  },
  {
    key: 'obec_requests',
    label: 'Žádosti k vyřízení (obec)',
    description: 'Žádosti o roli, stížnosti, pozvánky a návrhy importu, které čekají na vás jako na správci obce.',
    locked: false,
  },
  {
    key: 'obec_billing',
    label: 'Obec: licence, SMS a provoz',
    description: 'Stav licence a služeb obce, vyčerpané SMS, provozní upozornění.',
    locked: true,
  },
  {
    key: 'account',
    label: 'Účet a data',
    description: 'Export vašich dat, ukončení smlouvy obce a další upozornění k účtu.',
    locked: true,
  },
] as const

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]['key']

/** The circles a user may switch off by e-mail — Profiles.emailMuted holds a subset of these. */
export const MUTABLE_NOTIFICATION_CATEGORIES = NOTIFICATION_CATEGORIES.filter((c) => !c.locked)

export const MUTABLE_CATEGORY_KEYS = MUTABLE_NOTIFICATION_CATEGORIES.map((c) => c.key)

export const isMutableCategory = (key: NotificationCategory): boolean => MUTABLE_CATEGORY_KEYS.some((k) => k === key)

/** Which circles a user is told about, by what they are — a participant never sees the obec's. */
export type NotificationAudience = { organizer: boolean; obecAdmin: boolean }

export const categoriesVisibleTo = ({ organizer, obecAdmin }: NotificationAudience) =>
  MUTABLE_NOTIFICATION_CATEGORIES.filter((c) => {
    if (c.key === 'my_events') return organizer || obecAdmin
    if (c.key === 'obec_requests') return obecAdmin
    return true
  })
