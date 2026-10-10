"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AccessibilityControls } from "@/components/AccessibilityControls";
import { Accessibility } from "lucide-react";

/** Opens the font-size/high-contrast controls (US-H-07) without an account — in the guest top bar
 * and on the sign-in screens, where someone arriving from an e-mail link lands first. */
export function AccessibilityMenuButton({ className }: { className?: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Zobrazení a přístupnost" className={className}>
          <Accessibility className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Zobrazení</DialogTitle>
        </DialogHeader>
        <AccessibilityControls />
      </DialogContent>
    </Dialog>
  );
}
