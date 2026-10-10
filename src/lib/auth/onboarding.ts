/**
 * Where someone who hasn't finished onboarding is sent — with the page they were headed to, so they
 * land there afterwards instead of on the home page (a guest who signed up from an event's "Přihlásit
 * se" belongs back on that event). The home page carries nothing: it's where onboarding ends anyway.
 */
export const onboardingPath = (returnTo?: string | null): string =>
  returnTo && returnTo !== "/" ? `/onboarding?redirect=${encodeURIComponent(returnTo)}` : "/onboarding";
