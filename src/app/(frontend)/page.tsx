"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  getMunicipality,
  getEventCategories,
  getUpcomingEvents,
  getActiveRegistrationCountsByEvent,
} from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { EventCard, EventCardData } from "@/components/EventCard";
import { Loading } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Sparkles, MapPin } from "lucide-react";
import { isToday, isThisWeek, isPast } from "@/lib/date";
import { getCategoryIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type Filter = "all" | "today" | "week";

interface Category { id: string; name: string; icon: string; color: string }

function IndexContent() {
  const { profile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [events, setEvents] = useState<EventCardData[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [categoryId, setCategoryId] = useState<string | null>(searchParams.get("kategorie"));
  const [loading, setLoading] = useState(true);
  const [muniName, setMuniName] = useState<string>("");

  useEffect(() => {
    setCategoryId(searchParams.get("kategorie"));
  }, [searchParams]);

  const updateCategory = (next: string | null) => {
    setCategoryId(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("kategorie", next); else params.delete("kategorie");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const muniId = profile?.municipality_id;
      if (!muniId) {
        setLoading(false);
        return;
      }

      const [muni, cats, ev, counts] = await Promise.all([
        getMunicipality(muniId),
        getEventCategories(),
        getUpcomingEvents(muniId),
        getActiveRegistrationCountsByEvent(),
      ]);

      if (!active) return;
      setMuniName(muni?.name ?? "");
      setCategories(cats);

      const catMap = new Map(cats.map((c) => [c.id, c]));

      const mapped: EventCardData[] = ev
        .filter((e) => !isPast(e.date_time))
        .map((e) => ({
          id: e.id,
          title: e.title,
          date_time: e.date_time,
          location_text: e.location_text,
          capacity: e.capacity,
          image_url: e.image_url,
          registrations_count: counts.get(e.id) ?? 0,
          category: e.category_id ? catMap.get(e.category_id) ?? null : null,
        }));
      setEvents(mapped);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [profile?.municipality_id]);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (categoryId && e.category && (categories.find((c) => c.id === categoryId)?.name !== e.category.name)) return false;
      if (categoryId && !e.category) return false;
      if (filter === "today") return isToday(e.date_time);
      if (filter === "week") return isThisWeek(e.date_time);
      return true;
    });
  }, [events, filter, categoryId, categories]);

  const recommended = useMemo(() => {
    // doporučené = nejbližší 3 akce s volnými místy
    return [...events]
      .filter((e) => (e.registrations_count ?? 0) < e.capacity)
      .sort((a, b) => new Date(a.date_time).getTime() - new Date(b.date_time).getTime())
      .slice(0, 3);
  }, [events]);

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <header className="px-4 pt-6 pb-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <MapPin className="h-4 w-4" />
          <span>{muniName || "Vaše obec"}</span>
        </div>
        <h1 className="text-3xl font-extrabold leading-tight">Akce v obci</h1>
        <p className="text-muted-foreground mt-1">Vyberte si akci a přihlaste se.</p>
      </header>

      {loading ? (
        <Loading />
      ) : (
        <>
          {/* Doporučené */}
          {recommended.length > 0 && filter === "all" && !categoryId && (
            <section className="mb-6">
              <div className="flex items-center gap-2 px-4 mb-3">
                <Sparkles className="h-5 w-5 text-accent" />
                <h2 className="text-lg font-bold">Doporučené pro vás</h2>
              </div>
              <div className="flex gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory sm:hidden">
                {recommended.map((e) => (
                  <div key={e.id} className="snap-start shrink-0 w-[78%]">
                    <EventCard event={e} />
                  </div>
                ))}
              </div>
              <div className="hidden sm:grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 px-4">
                {recommended.map((e) => (
                  <EventCard key={e.id} event={e} />
                ))}
              </div>
            </section>
          )}

          {/* Filtry */}
          <div className="px-4 mb-3">
            <div className="flex gap-2">
              {([
                { key: "all", label: "Všechny" },
                { key: "today", label: "Dnes" },
                { key: "week", label: "Tento týden" },
              ] as { key: Filter; label: string }[]).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "px-4 py-2 rounded-full text-sm font-semibold transition-colors border-[1.5px]",
                    filter === f.key
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-foreground border-border hover:border-brand-purple",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Kategorie */}
          <div className="mb-4">
            <div className="flex gap-2 overflow-x-auto px-4 pb-2">
              <button
                onClick={() => updateCategory(null)}
                className={cn(
                  "shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border-[1.5px] transition-colors",
                  !categoryId
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-foreground border-border hover:border-brand-purple",
                )}
              >
                Vše
              </button>
              {categories.map((c) => {
                const Icon = getCategoryIcon(c.icon);
                const active = categoryId === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => updateCategory(active ? null : c.id)}
                    className={cn(
                      "shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border-[1.5px] transition-colors",
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-foreground border-border hover:border-brand-purple",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Seznam */}
          <section className="px-4">
            {filtered.length === 0 ? (
              <EmptyState
                title="Žádné akce"
                description="V této kategorii momentálně nic není. Zkuste jiný filtr."
                action={
                  <Button variant="outline" onClick={() => { setFilter("all"); setCategoryId(null); }}>
                    Zobrazit vše
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((e) => <EventCard key={e.id} event={e} />)}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default function IndexPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<Loading />}>
        <IndexContent />
      </Suspense>
    </RequireAuth>
  );
}
