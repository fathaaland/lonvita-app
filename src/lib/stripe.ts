import { loadStripe, type Stripe } from "@stripe/stripe-js";

const clientToken = process.env.NEXT_PUBLIC_PAYMENTS_CLIENT_TOKEN;
const environment: "sandbox" | "live" = clientToken?.startsWith("pk_test_") ? "sandbox" : "live";

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    if (!clientToken) throw new Error("NEXT_PUBLIC_PAYMENTS_CLIENT_TOKEN není nastaven.");
    stripePromise = loadStripe(clientToken);
  }
  return stripePromise;
}

export function getStripeEnvironment() {
  return environment;
}

/** Cena v haléřích → "150 Kč" */
export function formatCzk(cents: number | null | undefined): string {
  if (cents == null) return "";
  return `${Math.round(cents / 100).toLocaleString("cs-CZ")} Kč`;
}

export const PLATFORM_FEE = 0.05;

export const CANCELLATION_LABEL: Record<string, string> = {
  none: "Bez možnosti vrácení",
  cancel_24h: "Vrácení do 24 h před akcí",
  cancel_48h: "Vrácení do 48 h před akcí",
  cancel_7d: "Vrácení do 7 dní před akcí",
};

export function withinCancelWindow(dateTime: string, policy: string): boolean {
  if (policy === "none") return false;
  const hours = policy === "cancel_24h" ? 24 : policy === "cancel_48h" ? 48 : policy === "cancel_7d" ? 24 * 7 : 0;
  const deadline = new Date(dateTime).getTime() - hours * 3600 * 1000;
  return Date.now() <= deadline;
}
