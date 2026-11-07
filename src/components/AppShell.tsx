'use client'

import { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { BottomNav } from './BottomNav'
import { TopNav } from './TopNav'
import { GuestTopBar } from './GuestTopBar'
import { AccessibilityMenuButton } from './AccessibilityMenuButton'
import { LonvitaLogo, BrandWave } from './LonvitaLogo'
import { useAuth } from '@/contexts/AuthContext'

interface AppShellProps {
  children: ReactNode
  noBottomPadding?: boolean
}

// Routes that keep a narrow, focused reading column even on desktop.
const NARROW_PREFIXES = ['/auth', '/onboarding', '/reset-password']

export function AppShell({ children, noBottomPadding }: AppShellProps) {
  const { user } = useAuth()
  const pathname = usePathname()
  const isNarrow = NARROW_PREFIXES.some((p) => pathname.startsWith(p))
  // Full-bleed width is a property of the route, not of being logged in — anonymous visitors
  // browsing read-only (brief §2) need the same wide grid as signed-in users. TopNav itself
  // stays auth-gated since its links (Moje akce, Vytvořit, Profil...) require an account.
  const isWide = !isNarrow

  return (
    <div className="[container-type:inline-size] min-h-screen bg-background">
      {/* First thing a keyboard reaches — past the navigation straight to the page (WCAG 2.4.1). */}
      <a
        href="#obsah"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
      >
        Přeskočit na obsah
      </a>
      {isWide && !!user && <TopNav />}
      {isWide && !user && <GuestTopBar />}
      {/* The sign-in screens have no top bar — someone arriving from an e-mail link still needs
          to make the text readable before typing anything. */}
      {isNarrow && (
        <AccessibilityMenuButton className="fixed right-3 top-3 z-40 bg-background/80 backdrop-blur" />
      )}
      {isNarrow ? (
        <div className="lg:grid lg:grid-cols-2 lg:min-h-screen">
          {/* Desktop/tablet-landscape only — on phones the card's own header carries the branding.
              An even split, not a narrow sidebar: these screens are half brand, half form. */}
          <div className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:items-center lg:justify-center lg:gap-6 lg:overflow-hidden lg:brand-panel lg:p-8 lg:text-center">
            <BrandWave
              className="absolute -bottom-10 -left-10 h-64 w-[140%] opacity-20 dark:hidden"
              color="hsl(var(--brand-sand))"
            />
            {/* Dark mode: the wave turns into a lit purple ribbon — the one bright thing in the panel. */}
            <BrandWave
              className="absolute -bottom-10 -left-10 hidden h-64 w-[140%] opacity-40 [filter:drop-shadow(0_0_36px_hsl(var(--brand-purple)/0.9))] dark:block"
              color="hsl(var(--brand-purple))"
            />
            <LonvitaLogo variant="on-dark" size="xl" className="relative" />
            <p className="relative max-w-[280px] text-sm leading-relaxed text-[hsl(var(--brand-sand))]">
              Objevujte, co se děje ve vašem městě.
            </p>
          </div>
          {/* This lane spans the full viewport pre-lg and the right half from lg onward — a
              container, so anything sized in container query units stays out of the branding
              panel. The column itself stays a reading width: a form stretched across half a
              desktop screen is unreadable however much room there is. */}
          <div className="[container-type:inline-size] lg:flex lg:min-h-screen lg:flex-col lg:justify-center">
            <main
              id="obsah"
              tabIndex={-1}
              className={`mx-auto w-full max-w-[480px] lg:max-w-[440px] lg:px-8 lg:py-8 focus:outline-none ${
                noBottomPadding ? '' : 'safe-bottom'
              }`}
            >
              {children}
            </main>
          </div>
        </div>
      ) : (
        <main
          id="obsah"
          tabIndex={-1}
          className={`mx-auto focus:outline-none ${
            isWide
              ? 'max-w-[480px] sm:max-w-none sm:w-full sm:px-6 lg:px-10 xl:px-16 2xl:max-w-[1600px]'
              : 'max-w-[480px]'
          } ${noBottomPadding ? '' : 'safe-bottom'}`}
        >
          {children}
        </main>
      )}
      {!isNarrow && (
        <div className={isWide ? 'sm:hidden' : ''}>
          <BottomNav />
        </div>
      )}
    </div>
  )
}
