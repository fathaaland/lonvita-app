"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useFontSize } from "@/contexts/FontSizeContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Type, Contrast, Monitor, Moon, Sun } from "lucide-react";

const SIZE_LABELS = { normal: "Běžné písmo", large: "Větší písmo", xlarge: "Největší písmo" } as const;

const THEMES = [
  { value: "light", label: "Světlý", icon: Sun },
  { value: "dark", label: "Tmavý", icon: Moon },
  { value: "system", label: "Podle systému", icon: Monitor },
] as const;

/** Font size, light/dark appearance and high-contrast toggle (US-H-07). Shared between the guest
 * menu and /profil so both signed-out and signed-in users reach the same controls. */
export function AccessibilityControls() {
  const { size, setSize, highContrast, setHighContrast } = useFontSize();
  const { theme, setTheme } = useTheme();
  // The stored theme is only known in the browser — no button is pressed until then.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="eyebrow"><Moon className="h-3 w-3" /> Vzhled</div>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant={mounted && theme === value ? "default" : "outline"}
              onClick={() => setTheme(value)}
              className="h-12 flex-col gap-0.5 text-xs"
              aria-pressed={mounted && theme === value}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div className="eyebrow"><Type className="h-3 w-3" /> Velikost písma</div>
        <div className="grid grid-cols-3 gap-2">
          {(["normal", "large", "xlarge"] as const).map((s) => (
            <Button
              key={s}
              variant={size === s ? "default" : "outline"}
              onClick={() => setSize(s)}
              className="h-12"
              // Each button shows just an "A" — a screen reader needs to hear which size it is.
              aria-label={SIZE_LABELS[s]}
              aria-pressed={size === s}
            >
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
