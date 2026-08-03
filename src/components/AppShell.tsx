"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BottomNav } from "./BottomNav";
import { TopNav } from "./TopNav";
import { PaymentTestModeBanner } from "./PaymentTestModeBanner";
import { useAuth } from "@/contexts/AuthContext";

interface AppShellProps {
  children: ReactNode;
  noBottomPadding?: boolean;
}

// Routes that keep a narrow, focused reading column even on desktop.
const NARROW_PREFIXES = ["/auth", "/onboarding"];

export function AppShell({ children, noBottomPadding }: AppShellProps) {
  const { user } = useAuth();
  const pathname = usePathname();
  const isNarrow = NARROW_PREFIXES.some((p) => pathname.startsWith(p));
  const isWide = !isNarrow && !!user;

  return (
    <div className="min-h-screen bg-background">
      <PaymentTestModeBanner />
      {isWide && <TopNav />}
      <div
        className={`mx-auto ${
          isWide
            ? "max-w-[480px] sm:max-w-none sm:w-full sm:px-6 lg:px-10 xl:px-16 2xl:max-w-[1600px]"
            : "max-w-[480px]"
        } ${noBottomPadding ? "" : "safe-bottom"}`}
      >
        {children}
      </div>
      {!isNarrow && (
        <div className={isWide ? "sm:hidden" : ""}>
          <BottomNav />
        </div>
      )}
    </div>
  );
}
