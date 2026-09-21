const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (value) => Boolean(value && EMAIL_RE.test(value));
export const MIN_PASSWORD_LENGTH = 8;
export const isValidPassword = (value) => Boolean(value && value.length >= MIN_PASSWORD_LENGTH);
