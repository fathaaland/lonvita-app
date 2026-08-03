"use client";

import { useEffect, useState } from "react";
import { getMyRegistrationsWithEvents, RegistrationWithEventRow } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { EventCard, EventCardData } from "@/components/EventCard";
import { Loading } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { CalendarHeart, Clock } from "lucide-react";
import { isPast } from "@/lib/date";

type Row = RegistrationWithEventRow;

function MyEventsContent() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const data = await getMyRegistrationsWithEvents(String(user.id));
      setRows(data);
      setLoading(false);
    })();
  }, [user]);

  const upcoming = rows.filter((r) => r.events && !isPast(r.events.date_time));
  const past = rows.filter((r) => r.events && isPast(r.events.date_time));

  const toCard = (r: Row): EventCardData => ({
    id: r.events!.id,
    title: r.events!.title,
    date_time: r.events!.date_time,
    location_text: r.events!.location_text,
    capacity: r.events!.capacity,
    image_url: r.events!.image_url,
    category: r.events!.category,
  });

  return (
    <div className="animate-fade-in">
      <PageHeader title="Moje akce" subtitle="Akce, na které jste se přihlásili" />
      {loading ? <Loading /> : (
        <Tabs defaultValue="upcoming" className="px-4 pt-4">
          <TabsList className="w-full h-12">
            <TabsTrigger value="upcoming" className="flex-1 text-base">Nadcházející ({upcoming.length})</TabsTrigger>
            <TabsTrigger value="past" className="flex-1 text-base">Proběhlé ({past.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="pt-4">
            {upcoming.length === 0 ? (
              <EmptyState icon={CalendarHeart} title="Zatím žádné přihlášky" description="Vyberte si akci z hlavní stránky." />
            ) : (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {upcoming.map((r) => (
                  <div key={r.events!.id} className="relative">
                    <EventCard event={toCard(r)} />
                    {r.status === "pending" && (
                      <Badge className="absolute top-3 right-16 bg-warning text-warning-foreground gap-1">
                        <Clock className="h-3 w-3" /> Čeká
                      </Badge>
                    )}
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
                {past.map((r) => <EventCard key={r.events!.id} event={toCard(r)} />)}
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
