"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { formatEventDate } from "@/lib/date";
import { ChevronRight, Trash2 } from "lucide-react";
import { EventRow, RegistrationRow, CategoryRow, ProfileRow } from "@/lib/analytics";
import { deleteEvent } from "@/integrations/payload/admin-queries";
import { toast } from "sonner";

interface Props {
  events: EventRow[];
  registrations: RegistrationRow[];
  categories: CategoryRow[];
  profiles: ProfileRow[];
  onDeleted?: () => void;
}

type Filter = "upcoming" | "past" | "all";

export function EventsTable({ events, registrations, categories, profiles, onDeleted }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (e: React.MouseEvent, eventId: string, title: string) => {
    e.stopPropagation();
    if (!window.confirm(`Opravdu zrušit akci „${title}“? Přihlášení účastníci dostanou upozornění a akce jim zmizí z přehledu.`)) return;
    setDeletingId(eventId);
    try {
      await deleteEvent(eventId);
      toast.success("Akce zrušena.");
      onDeleted?.();
    } catch {
      toast.error("Akci se nepodařilo zrušit.");
    } finally {
      setDeletingId(null);
    }
  };

  const cats = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const profs = useMemo(() => new Map(profiles.map((p) => [p.id, p.full_name])), [profiles]);
  const approved = useMemo(() => registrations.filter((r) => r.status === "approved"), [registrations]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const out = events.filter((e) => {
      const t = new Date(e.date_time).getTime();
      if (filter === "upcoming") return t >= now;
      if (filter === "past") return t < now;
      return true;
    });
    return out.sort((a, b) =>
      filter === "past"
        ? new Date(b.date_time).getTime() - new Date(a.date_time).getTime()
        : new Date(a.date_time).getTime() - new Date(b.date_time).getTime(),
    );
  }, [events, filter]);

  const FILTERS: { v: Filter; label: string }[] = [
    { v: "upcoming", label: "Nadcházející" },
    { v: "past", label: "Proběhlé" },
    { v: "all", label: "Vše" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-1 bg-muted rounded-lg p-1">
        {FILTERS.map((f) => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            className={`flex-1 h-9 rounded-md text-sm font-semibold transition-colors ${
              filter === f.v
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Žádné akce v této kategorii.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => {
            const a = approved.filter((r) => r.event_id === e.id).length;
            const cat = cats.get(e.category_id ?? "");
            const fill = e.capacity ? Math.round((a / e.capacity) * 100) : 0;
            return (
              <Card
                key={e.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => router.push(`/akce/${e.id}`)}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="font-bold text-sm truncate">{e.title}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      <span>{formatEventDate(e.date_time)}</span>
                      {cat && (
                        <Badge
                          variant="secondary"
                          className="h-5 text-[10px] px-1.5"
                          style={{ backgroundColor: `${cat.color}20`, color: cat.color }}
                        >
                          {cat.name}
                        </Badge>
                      )}
                      <span className="truncate">· {profs.get(e.organizer_id) ?? ""}</span>
                    </div>
                  </div>
                  <div className="text-right space-y-0.5">
                    <p className="text-sm font-bold tabular-nums">
                      {a}/{e.capacity}
                    </p>
                    <p className={`text-[10px] font-semibold tabular-nums ${
                      fill >= 85 ? "text-success" : fill >= 40 ? "text-primary" : "text-warning"
                    }`}>
                      {fill} %
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={deletingId === e.id}
                    onClick={(ev) => handleDelete(ev, e.id, e.title)}
                    aria-label="Smazat akci"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
