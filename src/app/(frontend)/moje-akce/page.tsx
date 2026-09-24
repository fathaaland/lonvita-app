"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  getMyRegistrationsWithEvents,
  getMyOrganizedEvents,
  getEventCategories,
  getMyFeedbackForRegistrations,
  AttendanceStatus,
} from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { EventCard, EventCardData } from "@/components/EventCard";
import { Loading } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EventFeedbackDialog, FeedbackTarget } from "@/components/EventFeedbackCard";
import { CalendarHeart, Clock, Megaphone, Star } from "lucide-react";
import { toast } from "sonner";
import { isPast } from "@/lib/date";
import { isMunicipalityOrganization } from "@/lib/organizations";

interface Item {
  event: EventCardData;
  isOrganizer: boolean;
  /** Not the viewer's own — they're here as the admin of the obec that runs or co-organizes it. */
  obecRole: "runs" | "coOrganizes" | null;
  isPending: boolean;
  /** The viewer's own approved registration — what "Ohodnotit" rates (US-U-03). */
  registration: { id: string; attendance: AttendanceStatus; rating: number | null } | null;
}

const organizerLabel = (item: Item, past: boolean) => {
  if (item.obecRole === "runs") return past ? "Pořádala obec" : "Pořádá obec";
  if (item.obecRole === "coOrganizes") return past ? "Spolupořádala obec" : "Spolupořádá obec";
  return past ? "Pořádali jste" : "Pořádáte";
};

/** Opened from the "Jak se vám akce líbila?" notification (worker feedback-request job). */
const RATE_PARAM = "hodnotit";

/** Under a past event the viewer took part in: the rating, the way to give one, or why not yet. */
function RatingRow({ item, onRate }: { item: Item; onRate: () => void }) {
  const reg = item.registration;
  if (!reg) return null;
  if (reg.rating !== null) {
    return (
      <p className="mt-2 flex items-center gap-1.5 px-1 text-sm text-muted-foreground">
        <Star className="h-4 w-4 fill-[hsl(var(--warning))] text-[hsl(var(--warning))]" />
        Ohodnoceno {reg.rating} z 5
      </p>
    );
  }
  if (reg.attendance === "attended") {
    return (
      <Button variant="outline" onClick={onRate} className="mt-2 w-full gap-2">
        <Star /> Ohodnotit akci
      </Button>
    );
  }
  if (reg.attendance === "not_marked") {
    return <p className="mt-2 px-1 text-sm text-muted-foreground">Ohodnotit půjde, až pořadatel potvrdí vaši účast.</p>;
  }
  return null;
}

function MyEventsContent() {
  const { user, administeredMunicipalityIds } = useAuth();
  const administeredKey = administeredMunicipalityIds.join(",");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rateParam = searchParams.get(RATE_PARAM);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(rateParam ? "past" : "upcoming");
  const [rating, setRating] = useState<FeedbackTarget | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [regs, organized, categories] = await Promise.all([
        getMyRegistrationsWithEvents(String(user.id)),
        getMyOrganizedEvents(String(user.id), administeredMunicipalityIds),
        getEventCategories(),
      ]);
      const catMap = new Map(categories.map((c) => [c.id, c]));
      const catsFor = (ids: string[]) => ids.map((id) => catMap.get(id)).filter((c): c is typeof categories[number] => Boolean(c));

      // Merged by event id — an organizer who's also registered for their own event
      // (auto-approved, see Registrations.ts) should only show up once, as organizer.
      const byId = new Map<string, Item>();

      const uid = String(user.id);
      for (const ev of organized) {
        const own = ev.organizer_id === uid || ev.co_organizer_ids.includes(uid);
        byId.set(ev.id, {
          event: {
            id: ev.id,
            title: ev.title,
            date_time: ev.date_time,
            location_text: ev.location_text,
            capacity: ev.capacity,
            image_url: ev.image_url,
            image_position: ev.image_position,
            is_paid: ev.is_paid,
            price_cents: ev.price_cents,
            categories: catsFor(ev.category_ids),
            organization: ev.organization,
            co_organizations: ev.co_organizations,
          },
          isOrganizer: true,
          obecRole: own
            ? null
            : isMunicipalityOrganization(ev.organization)
              ? "runs"
              : "coOrganizes",
          isPending: false,
          registration: null,
        });
      }

      // Cancelled/rejected rows aren't "my events" — and after a cancel + re-register they'd
      // otherwise shadow the live registration for the same event (first one wins below).
      const activeRegs = regs.filter((r) => r.status === "pending" || r.status === "approved");
      const attendedIds = activeRegs.filter((r) => r.attendance_status === "attended").map((r) => r.id);
      const feedback = await getMyFeedbackForRegistrations(attendedIds).catch(() => new Map());

      for (const r of activeRegs) {
        if (!r.events || byId.has(r.events.id)) continue;
        byId.set(r.events.id, {
          event: {
            id: r.events.id,
            title: r.events.title,
            date_time: r.events.date_time,
            location_text: r.events.location_text,
            capacity: r.events.capacity,
            image_url: r.events.image_url,
            image_position: r.events.image_position,
            is_paid: r.events.is_paid,
            price_cents: r.events.price_cents,
            categories: r.events.categories,
            organization: r.events.organization,
            co_organizations: r.events.co_organizations,
          },
          isOrganizer: false,
          obecRole: null,
          isPending: r.status === "pending",
          registration:
            r.status === "approved"
              ? { id: r.id, attendance: r.attendance_status, rating: feedback.get(r.id)?.satisfaction_rating ?? null }
              : null,
        });
      }

      setItems(Array.from(byId.values()));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, administeredKey]);

  // Arriving from the notification: open that event's rating straight away — or say why not.
  // The param is dropped afterwards so a reload or Back doesn't pop the dialog up again.
  useEffect(() => {
    if (loading || !rateParam) return;
    const item = items.find((i) => i.registration?.id === rateParam);
    const reg = item?.registration;
    if (item && reg?.attendance === "attended" && reg.rating === null) {
      setRating({ registrationId: reg.id, title: item.event.title });
    } else if (reg?.rating != null) {
      toast.info("Tuto akci jste už ohodnotili. Děkujeme!");
    } else {
      toast.error("Tuto akci teď ohodnotit nejde.");
    }
    router.replace(pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, rateParam]);

  const markRated = (registrationId: string, satisfaction: number) => {
    setItems((prev) =>
      prev.map((i) =>
        i.registration?.id === registrationId ? { ...i, registration: { ...i.registration, rating: satisfaction } } : i,
      ),
    );
    setRating(null);
  };

  const upcoming = items.filter((i) => !isPast(i.event.date_time));
  const past = items.filter((i) => isPast(i.event.date_time));

  return (
    <div className="animate-fade-in">
      <PageHeader title="Moje akce" subtitle="Akce, na které jste se přihlásili nebo které pořádáte" />
      {loading ? <Loading /> : (
        <Tabs value={tab} onValueChange={setTab} className="px-4 pt-4">
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
                        <Megaphone className="h-3 w-3" /> {organizerLabel(i, false)}
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
                        <Megaphone className="h-3 w-3" /> {organizerLabel(i, true)}
                      </Badge>
                    )}
                    <RatingRow
                      item={i}
                      onRate={() => i.registration && setRating({ registrationId: i.registration.id, title: i.event.title })}
                    />
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
      <EventFeedbackDialog target={rating} onClose={() => setRating(null)} onSubmitted={markRated} />
    </div>
  );
}

export default function MyEventsPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<Loading />}>
        <MyEventsContent />
      </Suspense>
    </RequireAuth>
  );
}
