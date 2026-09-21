import * as Icons from "lucide-react";
/**
 * Mapuje název ikony z DB na lucide-react ikonu.
 * V DB ukládáme PascalCase (Dumbbell, Music, ...).
 */
export function getCategoryIcon(name) {
    if (!name)
        return Icons.Tag;
    const Icon = Icons[name];
    return Icon ?? Icons.Tag;
}
