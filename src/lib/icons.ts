import * as Icons from "lucide-react";
import { LucideIcon } from "lucide-react";

/**
 * Mapuje název ikony z DB na lucide-react ikonu.
 * V DB ukládáme PascalCase (Dumbbell, Music, ...).
 */
export function getCategoryIcon(name: string | null | undefined): LucideIcon {
  if (!name) return Icons.Tag;
  const Icon = (Icons as unknown as Record<string, LucideIcon>)[name];
  return Icon ?? Icons.Tag;
}
