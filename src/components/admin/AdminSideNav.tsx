"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UnreadBadge } from "@/components/UnreadBadge";
import {
  BarChart3,
  CalendarRange,
  HandHeart,
  ClipboardList,
  Users,
  Download,
  Settings,
  LucideIcon,
} from "lucide-react";

export const ADMIN_NAV: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "overview", label: "Přehled", icon: BarChart3 },
  { value: "events", label: "Akce", icon: CalendarRange },
  { value: "volunteers", label: "Dobrovolníci", icon: HandHeart },
  { value: "organizers", label: "Organizátoři", icon: Users },
  { value: "requests", label: "Žádosti", icon: ClipboardList },
  { value: "import", label: "Import akcí", icon: Download },
  { value: "settings", label: "Nastavení", icon: Settings },
];

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Items waiting on the admin, per section — e.g. undecided requests. */
  badges?: Partial<Record<string, number>>;
}

export function AdminSideNav({ value, onChange, badges = {} }: Props) {
  return (
    <aside className="hidden md:block w-60 shrink-0">
      <div className="sticky top-20 space-y-1 rounded-2xl bg-card border border-border p-3">
        <div className="eyebrow px-3 pt-1 pb-2">Přehled obce</div>
        {ADMIN_NAV.map((item) => {
          const Icon = item.icon;
          const active = value === item.value;
          return (
            <Button
              key={item.value}
              variant="ghost"
              onClick={() => onChange(item.value)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative h-auto w-full justify-start gap-3 rounded-lg px-3 py-2.5 font-semibold",
                active
                  ? "bg-brand-purple-pale text-brand-purple-dark hover:bg-brand-purple-pale hover:text-brand-purple-dark"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon />
              <span className="flex-1 text-left">{item.label}</span>
              {(badges[item.value] ?? 0) > 0 && (
                <>
                  <UnreadBadge count={badges[item.value]!} className="static" />
                  <span className="sr-only">{`, čeká na vyřízení: ${badges[item.value]}`}</span>
                </>
              )}
            </Button>
          );
        })}
      </div>
    </aside>
  );
}
