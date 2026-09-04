"use client";

import { Home, CalendarHeart, PlusCircle, User, Shield, Bell } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useUnreadNotificationCount } from "@/hooks/useUnreadNotificationCount";
import { cn } from "@/lib/utils";

export function BottomNav() {
  const { user, isSuperAdmin, isAdmin, isOrganizer } = useAuth();
  const pathname = usePathname();
  const unreadCount = useUnreadNotificationCount();

  if (!user) return null;
  if (["/auth", "/onboarding", "/reset-password"].some((p) => pathname.startsWith(p))) return null;

  // A platform superadmin only ever operates inside the /superadmin panel — no home feed,
  // no personal event history, no profile settings.
  const items: { to: string; icon: typeof Home; label: string; badge?: number }[] = isSuperAdmin
    ? [{ to: "/superadmin", icon: Shield, label: "Superadmin" }]
    : [
        { to: "/", icon: Home, label: "Domů" },
        { to: "/moje-akce", icon: CalendarHeart, label: "Moje akce" },
        ...(isOrganizer ? [{ to: "/vytvorit", icon: PlusCircle, label: "Vytvořit" }] : []),
        ...(isAdmin ? [{ to: "/admin-obce", icon: Shield, label: "Obec" }] : []),
        { to: "/oznameni", icon: Bell, label: "Oznámení", badge: unreadCount },
        { to: "/profil", icon: User, label: "Profil" },
      ];

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto max-w-[480px] grid" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              href={item.to}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-2 text-xs font-semibold transition-colors",
                "min-h-[64px]",
                isActive ? "text-brand-purple-dark" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "relative inline-flex items-center justify-center rounded-full transition-colors",
                  isActive ? "bg-brand-purple-pale px-4 py-1" : "px-2 py-1",
                )}
              >
                <Icon className={cn("h-6 w-6", isActive && "stroke-[2.5]")} />
                {!!item.badge && (
                  <span className="absolute top-0 right-0.5 h-2 w-2 rounded-full bg-destructive" />
                )}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
