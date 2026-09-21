/** Cena v haléřích → "150 Kč" */
export function formatCzk(cents) {
    if (cents == null)
        return "";
    return `${Math.round(cents / 100).toLocaleString("cs-CZ")} Kč`;
}
