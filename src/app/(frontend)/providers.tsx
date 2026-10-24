"use client";

import { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { FontSizeProvider } from "@/contexts/FontSizeContext";
import { AppShell } from "@/components/AppShell";
import { ClientErrorReporter } from "@/components/ClientErrorReporter";

export function Providers({ children }: { children: ReactNode }) {
  return (
    // Světlý / tmavý / podle systému (AccessibilityControls) — the "dark" class on <html>.
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <FontSizeProvider>
        <TooltipProvider>
          <ClientErrorReporter />
          <Sonner />
          <AuthProvider>
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </TooltipProvider>
      </FontSizeProvider>
    </ThemeProvider>
  );
}
