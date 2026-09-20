"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BottomNav } from "./BottomNav";
import { TopNav } from "./TopNav";
import { GuestTopBar } from "./GuestTopBar";
import { PaymentTestModeBanner } from "./PaymentTestModeBanner";
import { LonvitaLogo, BrandWave } from "./LonvitaLogo";
import { useAuth } from "@/contexts/AuthContext";

interface AppShellProps {
  children: ReactNode;
  noBottomPadding?: boolean;
}

// Routes that keep a narrow, focused reading column even on desktop.
const NARROW_PREFIXES = ["/auth", "/onboarding", "/reset-password"];

export function AppShell({ children, noBottomPadding }: AppShellProps) {
  const { user } = useAuth();
  const pathname = usePathname();
  const isNarrow = NARROW_PREFIXES.some((p) => pathname.startsWith(p));
  // Full-bleed width is a property of the route, not of being logged in — anonymous visitors
  // browsing read-only (brief §2) need the same wide grid as signed-in users. TopNav itself
  // stays auth-gated since its links (Moje akce, Vytvořit, Profil...) require an account.
  const isWide = !isNarrow;

  return (
    <div className="[container-type:inline-size] min-h-screen bg-background">
      <PaymentTestModeBanner />
      {isWide && !!user && <TopNav />}
      {isWide && !user && <GuestTopBar />}
      {isNarrow ? (
        <div className="lg:grid lg:grid-cols-2 lg:min-h-screen">
          {/* Desktop/tablet-landscape only — on phones the card's own header carries the branding.
              An even split, not a narrow sidebar: these screens are half brand, half form. */}
          <div className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:items-center lg:justify-center lg:gap-6 lg:overflow-hidden lg:bg-gradient-to-br lg:from-[hsl(var(--brand-graphite))] lg:via-[hsl(var(--brand-graphite-mid))] lg:to-[hsl(var(--brand-purple-dark))] lg:p-8 lg:text-center">
            <BrandWave className="absolute -bottom-10 -left-10 h-64 w-[140%] opacity-20" color="hsl(var(--brand-sand))" />
            <LonvitaLogo variant="on-dark" size="xl" className="relative" />
            <p className="relative max-w-[280px] text-[15px] leading-relaxed text-[hsl(var(--brand-sand))]">
              Objevujte, co se děje ve vašem městě.
            </p>
          </div>
          {/* This lane spans the full viewport pre-lg and the right half from lg onward —
              MapBreakout measures against it (via container query units) so it never overflows
              into the branding panel. The column itself stays a reading width: a form stretched
              across half a desktop screen is unreadable however much room there is. */}
          <div className="[container-type:inline-size] lg:flex lg:min-h-screen lg:flex-col lg:justify-center">
            <div
              className={`mx-auto w-full max-w-[480px] lg:max-w-[440px] lg:px-8 lg:py-8 ${
                noBottomPadding ? "" : "safe-bottom"
              }`}
            >
              {children}
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`mx-auto ${
            isWide
              ? "max-w-[480px] sm:max-w-none sm:w-full sm:px-6 lg:px-10 xl:px-16 2xl:max-w-[1600px]"
              : "max-w-[480px]"
          } ${noBottomPadding ? "" : "safe-bottom"}`}
        >
          {children}
        </div>
      )}
      {!isNarrow && (
        <div className={isWide ? "sm:hidden" : ""}>
          <BottomNav />
        </div>
      )}
    </div>
  );
}
