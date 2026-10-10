/**
 * Twilio expects E.164, but people type numbers as they know them ("735 929 442", "+420 735…",
 * "00420…", a Slovak "+421 …"). A bare 9-digit number is Czech; anything unrecognisable is null.
 * Shared by the SMS sender (collections/shared/notify) and every form that asks for a phone, so a
 * number the form accepts is always one an SMS can actually go to.
 */
export function toE164(phone: string): string | null {
  const compact = phone.replace(/[^\d+]/g, "").replace(/^00/, "+");
  if (/^\+\d{9,15}$/.test(compact)) return compact;
  if (/^\d{9}$/.test(compact)) return `+420${compact}`;
  return null;
}

export const isValidPhone = (phone: string): boolean => toE164(phone) !== null;

export const INVALID_PHONE_MESSAGE = "Zadejte prosím platné telefonní číslo, např. 601 234 567 nebo +421 901 234 567.";
