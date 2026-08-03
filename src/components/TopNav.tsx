"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { LonvitaLogo } from "@/components/LonvitaLogo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LogOut } from "lucide-react";

/**
 * Horní navigace zobrazená pouze na "wide" stránkách (Admin, Manage)
 * a jen od breakpointu md nahoru. Na mobilu zůstává spodní BottomNav.
 */
export function TopNav() {
  const { user, isAdmin, isOrganizer, signOut } = useAuth();
  const pathname = usePathname();

  if (!user) return null;

  const links: { to: string; label: string; end?: boolean }[] = [
    { to: "/", label: "Domů", end: true },
    { to: "/moje-akce", label: "Moje akce" },
    ...(isOrganizer ? [{ to: "/vytvorit", label: "Vytvořit" }] : []),
    ...(isAdmin ? [{ to: "/admin-obce", label: "Přehled obce" }] : []),
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
        <Button variant="ghost" size="sm" onClick={signOut} className="gap-2">
          <LogOut className="h-4 w-4" />
          Odhlásit
        </Button>
      </div>
    </header>
  );
}
