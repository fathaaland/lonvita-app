"use client";

import { useEffect, useState } from "react";
import {
  getMyRegistrationsWithEvents,
  getMyOrganizedEvents,
  getEventCategories,
} from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { EventCard, EventCardData } from "@/components/EventCard";
import { Loading } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { CalendarHeart, Clock, Megaphone } from "lucide-react";
import { isPast } from "@/lib/date";

interface Item {
  event: EventCardData;
  isOrganizer: boolean;
  isPending: boolean;
}

function MyEventsContent() {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [regs, organized, categories] = await Promise.all([
        getMyRegistrationsWithEvents(String(user.id)),
        getMyOrganizedEvents(String(user.id)),
        getEventCategories(),
      ]);
      const catMap = new Map(categories.map((c) => [c.id, c]));
      const catsFor = (ids: string[]) => ids.map((id) => catMap.get(id)).filter((c): c is typeof categories[number] => Boolean(c));

      // Merged by event id — an organizer who's also registered for their own event
      // (auto-approved, see Registrations.ts) should only show up once, as organizer.
      const byId = new Map<string, Item>();

      for (const ev of organized) {
        byId.set(ev.id, {
          event: {
            id: ev.id,
            title: ev.title,
            date_time: ev.date_time,
            location_text: ev.location_text,
            capacity: ev.capacity,
            image_url: ev.image_url,
            is_paid: ev.is_paid,
            price_cents: ev.price_cents,
            categories: catsFor(ev.category_ids),
          },
          isOrganizer: true,
          isPending: false,
        });
      }

      for (const r of regs) {
        if (!r.events || byId.has(r.events.id)) continue;
        byId.set(r.events.id, {
          event: {
            id: r.events.id,
            title: r.events.title,
            date_time: r.events.date_time,
            location_text: r.events.location_text,
            capacity: r.events.capacity,
            image_url: r.events.image_url,
            is_paid: r.events.is_paid,
            price_cents: r.events.price_cents,
            categories: r.events.categories,
          },
          isOrganizer: false,
          isPending: r.status === "pending",
        });
      }

      setItems(Array.from(byId.values()));
      setLoading(false);
    })();
  }, [user]);

  const upcoming = items.filter((i) => !isPast(i.event.date_time));
  const past = items.filter((i) => isPast(i.event.date_time));

  return (
    <div className="animate-fade-in">
      <PageHeader title="Moje akce" subtitle="Akce, na které jste se přihlásili nebo které pořádáte" />
      {loading ? <Loading /> : (
        <Tabs defaultValue="upcoming" className="px-4 pt-4">
          <TabsList className="w-full h-12">
            <TabsTrigger value="upcoming" className="flex-1 text-base">Nadcházející ({upcoming.length})</TabsTrigger>
            <TabsTrigger value="past" className="flex-1 text-base">Proběhlé ({past.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="pt-4">
            {upcoming.length === 0 ? (
              <EmptyState icon={CalendarHeart} title="Zatím žádné akce" description="Vyberte si akci z hlavní stránky, nebo nějakou uspořádejte." />
            ) : (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {upcoming.map((i) => (
                  <div key={i.event.id} className="relative">
                    <EventCard event={i.event} />
                    {i.isOrganizer ? (
                      <Badge className="absolute top-3 left-3 bg-primary text-primary-foreground gap-1">
                        <Megaphone className="h-3 w-3" /> Pořádáte
                      </Badge>
                    ) : i.isPending ? (
                      <Badge className="absolute top-3 left-3 bg-warning text-warning-foreground gap-1">
                        <Clock className="h-3 w-3" /> Čeká
                      </Badge>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="past" className="pt-4">
            {past.length === 0 ? (
              <EmptyState icon={CalendarHeart} title="Žádné proběhlé akce" />
            ) : (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {past.map((i) => (
                  <div key={i.event.id} className="relative">
                    <EventCard event={i.event} />
                    {i.isOrganizer && (
                      <Badge className="absolute top-3 left-3 bg-primary text-primary-foreground gap-1">
                        <Megaphone className="h-3 w-3" /> Pořádali jste
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

export default function MyEventsPage() {
  return (
    <RequireAuth>
      <MyEventsContent />
    </RequireAuth>
  );
}
