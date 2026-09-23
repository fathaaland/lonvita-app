"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useUnreadNotificationCount } from "@/hooks/useUnreadNotificationCount";
import { LonvitaLogo } from "@/components/LonvitaLogo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Bell, LogOut } from "lucide-react";

/**
 * Horní navigace zobrazená pouze na "wide" stránkách (Admin, Manage)
 * a jen od breakpointu md nahoru. Na mobilu zůstává spodní BottomNav.
 */
export function TopNav() {
  const {
    user,
    isSuperAdmin,
    isAdmin,
    isOrganizer,
    administeredMunicipalityIds,
    organizerMunicipalityIds,
    viewingMunicipalityId,
    signOut,
  } = useAuth();
  const pathname = usePathname();
  const unreadCount = useUnreadNotificationCount();

  // The /superadmin panel IS the entire app for a platform superadmin — no other section
  // to navigate to, so no top bar at all (it has its own header with a logout action).
  if (!user || isSuperAdmin) return null;

  // `viewingMunicipalityId` is the obec the home page's switcher is currently browsing — not
  // necessarily one this admin/organizer actually holds a role in (brief §"uživatel není vázaný
  // lokací"). `null` = not yet known/default, treated as "own obec". Actual creation is always
  // scoped server-side regardless of this; this only keeps the navbar from suggesting an action
  // that isn't actually available while browsing a municipality they don't administer.
  const canCreateHere =
    viewingMunicipalityId == null ||
    organizerMunicipalityIds.includes(viewingMunicipalityId) ||
    administeredMunicipalityIds.includes(viewingMunicipalityId);
  const canManageObecHere =
    viewingMunicipalityId == null || administeredMunicipalityIds.includes(viewingMunicipalityId);

  const links: { to: string; label: string; end?: boolean }[] = [
    { to: "/", label: "Domů", end: true },
    { to: "/moje-akce", label: "Moje akce" },
    ...(isOrganizer && canCreateHere ? [{ to: "/vytvorit", label: "Vytvořit" }] : []),
    ...(isAdmin && canManageObecHere ? [{ to: "/admin-obce", label: "Přehled obce" }] : []),
    // The organization they run events as — the obec's own one for its admin.
    ...(isOrganizer ? [{ to: "/organizace", label: "Organizace" }] : []),
    { to: "/profil", label: "Profil" },
  ];

  return (
    <header className="hidden sm:block sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto w-full px-6 lg:px-10 xl:px-16 2xl:max-w-[1600px] h-16 flex items-center gap-6">
        <Link href="/" className="shrink-0">
          <LonvitaLogo size="sm" />
        </Link>
        <nav className="flex items-center gap-1 flex-1">
          {links.map((l) => {
            const isActive = l.end ? pathname === l.to : pathname.startsWith(l.to);
            return (
              <Link
                key={l.to}
                href={l.to}
                className={cn(
                  "px-3 py-2 rounded-md text-sm font-semibold transition-colors",
                  isActive
                    ? "bg-brand-purple-pale text-brand-purple-dark"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/oznameni"
          className="relative h-9 w-9 rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Oznámení"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" />
          )}
        </Link>
        <Button variant="ghost" size="sm" onClick={signOut} className="gap-2">
          <LogOut className="h-4 w-4" />
          Odhlásit
        </Button>
      </div>
    </header>
  );
}
