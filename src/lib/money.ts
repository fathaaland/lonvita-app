/** Cena v haléřích → "150 Kč" */
export function formatCzk(cents: number | null | undefined): string {
  if (cents == null) return "";
  return `${Math.round(cents / 100).toLocaleString("cs-CZ")} Kč`;
}

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
