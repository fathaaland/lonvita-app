/** What an organizer runs events as. Everyone organizing gets one — a person with no business or
 * club (walks with the pensioners) is simply an "individual", so a spolupořadatel is always an
 * organization and nothing has to branch on it. */
export const ORGANIZATION_TYPES = [
  { value: 'business', label: 'Podnik' },
  { value: 'association', label: 'Spolek' },
  { value: 'individual', label: 'Jednotlivec' },
] as const

/** What an organizer picks for their organization. */
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number]['value']

/** The obec's own organization — exactly one per obec, without an owner (any of its admins acts
 * for it). Created with the obec, never picked or requested: whatever the obec's admin founds is run
 * by it, and a pořadatel asks the obec to co-organize (CoOrganizingRequests). */
export const MUNICIPALITY_ORGANIZATION_TYPE = 'municipality'

export type AnyOrganizationType = OrganizationType | typeof MUNICIPALITY_ORGANIZATION_TYPE

export const organizationTypeLabel = (type: string | null | undefined): string =>
  type === MUNICIPALITY_ORGANIZATION_TYPE
    ? 'Obec'
    : (ORGANIZATION_TYPES.find((t) => t.value === type)?.label ?? 'Jednotlivec')

export const isMunicipalityOrganization = (organization: { type?: string | null } | null | undefined): boolean =>
  organization?.type === MUNICIPALITY_ORGANIZATION_TYPE

export const isOrganizationType = (value: unknown): value is OrganizationType =>
  ORGANIZATION_TYPES.some((t) => t.value === value)

export const ORGANIZATION_NAME_MIN_LENGTH = 2
export const ORGANIZATION_NAME_MAX_LENGTH = 120
