/** What an organizer runs events as. Everyone organizing gets one — a person with no business or
 * club (walks with the pensioners) is simply an "individual", so a spolupořadatel is always an
 * organization and nothing has to branch on it. */
export const ORGANIZATION_TYPES = [
  { value: 'business', label: 'Podnik' },
  { value: 'association', label: 'Spolek' },
  { value: 'individual', label: 'Jednotlivec' },
] as const

export type OrganizationType = (typeof ORGANIZATION_TYPES)[number]['value']

export const organizationTypeLabel = (type: string | null | undefined): string =>
  ORGANIZATION_TYPES.find((t) => t.value === type)?.label ?? 'Jednotlivec'

export const isOrganizationType = (value: unknown): value is OrganizationType =>
  ORGANIZATION_TYPES.some((t) => t.value === value)

export const ORGANIZATION_NAME_MIN_LENGTH = 2
export const ORGANIZATION_NAME_MAX_LENGTH = 120
