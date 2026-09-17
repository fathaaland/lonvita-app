"use client";

import Link from "next/link";
import { LonvitaLogo } from "@/components/LonvitaLogo";
import { Button } from "@/components/ui/button";

/**
 * The only nav a signed-out visitor gets — TopNav/BottomNav both hide entirely for `!user`
 * since their links (Moje akce, Profil...) need an account. Without this, a guest browsing
 * the map or an event has no visible way to sign in short of guessing the /auth URL.
 * Unlike TopNav it stays visible on mobile too — there's no BottomNav standing in for it there.
 */
export function GuestTopBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto w-full px-4 sm:px-6 lg:px-10 xl:px-16 2xl:max-w-[1600px] h-14 sm:h-16 flex items-center justify-between gap-3">
        <Link href="/" className="shrink-0">
          <LonvitaLogo size="sm" />
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Button asChild variant="ghost" size="sm" className="px-2.5 sm:px-3">
            <Link href="/auth">Přihlásit se</Link>
          </Button>
          <Button asChild size="sm" className="px-3 sm:px-4">
            <Link href="/auth?mode=signup">Registrovat se</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
