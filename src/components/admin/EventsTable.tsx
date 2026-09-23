"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { formatEventDate } from "@/lib/date";
import { ChevronRight, Pencil, HandHeart, X } from "lucide-react";
import { EventRow, RegistrationRow, CategoryRow, ProfileRow } from "@/lib/analytics";
import { CancelEventButton } from "@/components/CancelEventButton";
import { removeVolunteeringFlag } from "@/integrations/payload/admin-queries";
import { toast } from "sonner";

interface Props {
  events: EventRow[];
  registrations: RegistrationRow[];
  categories: CategoryRow[];
  profiles: ProfileRow[];
  onDeleted?: () => void;
  /** A short note on the row, e.g. which events the organization only co-organizes. */
  tagFor?: (event: EventRow) => string | null;
}

type Filter = "upcoming" | "past" | "all";

export function EventsTable({ events, registrations, categories, profiles, onDeleted, tagFor }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [busyVolunteerId, setBusyVolunteerId] = useState<string | null>(null);

  const handleRemoveVolunteering = async (eventId: string) => {
    setBusyVolunteerId(eventId);
    try {
      await removeVolunteeringFlag(eventId);
      toast.success("Příznak Dobrovolnictví odebrán.");
      onDeleted?.();
    } catch {
      toast.error("Nepodařilo se odebrat příznak.");
    } finally {
      setBusyVolunteerId(null);
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
            const eventCats = e.category_ids.map((id) => cats.get(id)).filter((c): c is CategoryRow => Boolean(c));
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
                      {eventCats.map((cat) => (
                        <Badge
                          key={cat.id}
                          variant="secondary"
                          className="h-5 text-[10px] px-1.5"
                          style={{ backgroundColor: `${cat.color}20`, color: cat.color }}
                        >
                          {cat.name}
                        </Badge>
                      ))}
                      {profs.get(e.organizer_id) && <span className="truncate">· {profs.get(e.organizer_id)}</span>}
                      {tagFor?.(e) && (
                        <Badge variant="outline" className="h-5 text-[10px] px-1.5 font-semibold">
                          {tagFor(e)}
                        </Badge>
                      )}
                    </div>
                    {e.is_volunteering && (
                      <div onClick={(ev) => ev.stopPropagation()}>
                        <Badge
                          variant="secondary"
                          className="h-5 text-[10px] pl-1.5 pr-0.5 gap-1 text-[hsl(var(--brand-purple))] bg-[hsl(var(--brand-purple))]/10"
                        >
                          <HandHeart className="h-3 w-3" /> Dobrovolnictví
                          <button
                            type="button"
                            aria-label="Odebrat příznak Dobrovolnictví"
                            disabled={busyVolunteerId === e.id}
                            onClick={() => handleRemoveVolunteering(e.id)}
                            className="ml-0.5 rounded-full p-0.5 hover:bg-black/10"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      </div>
                    )}
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
                  {/* The obec admin's own event, co-organized by this viewer — theirs to help run,
                      not to edit or cancel. Same fixed widths keep the rows aligned. */}
                  {e.locked_for_viewer ? (
                    <div className="w-16 shrink-0" />
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          router.push(`/upravit/${e.id}`);
                        }}
                        aria-label="Upravit akci"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {/* Clicks inside the (portalled) confirmation dialog still bubble through the React
                          tree — stop them here so they don't also open the event. Fixed width keeps rows
                          aligned when the event can no longer be cancelled and the icon isn't shown. */}
                      <div className="w-8 shrink-0" onClick={(ev) => ev.stopPropagation()}>
                        {/* Co-organized: deleting needs the others' consent, asked from the detail. */}
                        {!e.deletion_needs_consent && (
                          <CancelEventButton
                            variant="icon"
                            eventId={e.id}
                            title={e.title}
                            dateTime={e.date_time}
                            onCancelled={onDeleted ?? (() => {})}
                          />
                        )}
                      </div>
                    </>
                  )}
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
