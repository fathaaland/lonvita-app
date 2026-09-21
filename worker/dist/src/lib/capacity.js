/**
 * "Neomezená kapacita" (unlimited capacity) isn't a real concept in the Events schema —
 * `capacity` stays a required positive integer (Registrations' capacity check just compares
 * counts against it). Unlimited is modelled as a large sentinel value instead, so every existing
 * comparison (`registrations_count < capacity`, fill-rate, etc.) keeps working unchanged; only
 * display spots need to special-case it to show "Neomezená kapacita" instead of the raw number.
 */
export const UNLIMITED_CAPACITY = 999999;
export const isUnlimitedCapacity = (capacity) => capacity >= UNLIMITED_CAPACITY;
