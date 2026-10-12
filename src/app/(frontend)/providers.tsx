"use client";

import { ReactNode } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { FontSizeProvider } from "@/contexts/FontSizeContext";
import { AppShell } from "@/components/AppShell";
import { ClientErrorReporter } from "@/components/ClientErrorReporter";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <FontSizeProvider>
      <TooltipProvider>
        <ClientErrorReporter />
        <Sonner />
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </TooltipProvider>
    </FontSizeProvider>
  );
}
