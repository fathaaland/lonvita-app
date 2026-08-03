"use client";

import { cn } from "@/lib/utils";
import {
  BarChart3,
  ClipboardList,
  CalendarRange,
  Wallet,
  HandHeart,
  Settings as SettingsIcon,
  LucideIcon,
} from "lucide-react";

export const ADMIN_NAV: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "overview", label: "Přehled", icon: BarChart3 },
  { value: "events", label: "Akce", icon: CalendarRange },
  { value: "finance", label: "Finance", icon: Wallet },
  { value: "volunteers", label: "Dobrovolníci", icon: HandHeart },
  { value: "requests", label: "Žádosti", icon: ClipboardList },
  { value: "settings", label: "Nastavení", icon: SettingsIcon },
];

interface Props {
  value: string;
  onChange: (v: string) => void;
  requestCount?: number;
}

export function AdminSideNav({ value, onChange, requestCount = 0 }: Props) {
  return (
    <aside className="hidden md:block w-60 shrink-0">
      <div className="sticky top-20 space-y-1 rounded-2xl bg-card border border-border p-3">
        <div className="eyebrow px-3 pt-1 pb-2">Přehled obce</div>
        {ADMIN_NAV.map((item) => {
          const Icon = item.icon;
          const active = value === item.value;
          return (
            <button
              key={item.value}
              onClick={() => onChange(item.value)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors relative",
                active
                  ? "bg-brand-purple-pale text-brand-purple-dark"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
              {item.value === "requests" && requestCount > 0 && (
                <span className="h-5 min-w-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                  {requestCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
