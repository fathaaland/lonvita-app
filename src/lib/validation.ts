const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const isValidEmail = (value: string | null | undefined): value is string =>
  Boolean(value && EMAIL_RE.test(value))

export const MIN_PASSWORD_LENGTH = 8

export const isValidPassword = (value: string | null | undefined): value is string =>
  Boolean(value && value.length >= MIN_PASSWORD_LENGTH)

/** Bounds for the "why do you want to organize here" text of an organizer-role request. */
export const ORGANIZER_REASON_MIN_LENGTH = 20
export const ORGANIZER_REASON_MAX_LENGTH = 1000
