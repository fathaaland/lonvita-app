"use client";

import { useFontSize } from "@/contexts/FontSizeContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Type, Contrast } from "lucide-react";

/** Font size + high-contrast toggle (US-H-07). Shared between the guest menu and /profil so
 * both signed-out and signed-in users reach the same controls. */
export function AccessibilityControls() {
  const { size, setSize, highContrast, setHighContrast } = useFontSize();

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="eyebrow"><Type className="h-3 w-3" /> Velikost písma</div>
        <div className="grid grid-cols-3 gap-2">
          {(["normal", "large", "xlarge"] as const).map((s) => (
            <Button key={s} variant={size === s ? "default" : "outline"} onClick={() => setSize(s)} className="h-12">
              <span className={s === "normal" ? "text-base" : s === "large" ? "text-lg" : "text-2xl"}>A</span>
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Contrast className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <Label htmlFor="high-contrast" className="text-base font-semibold">Vysoký kontrast</Label>
            <p className="text-sm text-muted-foreground mt-0.5">Černý text na bílém pozadí, výraznější okraje.</p>
          </div>
        </div>
        <Switch id="high-contrast" checked={highContrast} onCheckedChange={setHighContrast} />
      </div>
    </div>
  );
}
