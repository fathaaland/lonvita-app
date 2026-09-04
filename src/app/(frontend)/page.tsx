"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  getMunicipality,
  getEventCategories,
  getUpcomingEvents,
  getActiveRegistrationCountsByEvent,
  listMunicipalities,
  MunicipalityRow,
} from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { EventCard, EventCardData } from "@/components/EventCard";
import { Loading } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MunicipalitiesMap } from "@/components/map/MunicipalitiesMapClient";
import { Sparkles, MapPin, ChevronDown } from "lucide-react";
import { isToday, isThisWeek, isPast } from "@/lib/date";
import { getCategoryIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

// Brief §2 "Nepřihlášený návštěvník má mít možnost prohlédnout si přehled akcí v obci" + brief
// §"uživatel není vázaný lokací... může se přepínat mezi městy" — which municipality's events
// you're BROWSING is independent of a signed-in user's home municipality (profile.municipality_id)
// and remembered for the session only; switching here never changes their actual home town.
const VIEWING_MUNICIPALITY_KEY = "lonvita_viewing_municipality_id";

type Filter = "all" | "today" | "week";

interface Category { id: string; name: string; icon: string; color: string }

function IndexContent() {
  const { user, profile, loading: authLoading, isSuperAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // A platform superadmin has no community feed of their own — the /superadmin panel
  // is their entire dashboard, not a secondary section reached via the top nav.
  useEffect(() => {
    if (isSuperAdmin) router.replace("/superadmin");
  }, [isSuperAdmin, router]);

  // Onboarding gate for signed-in users only — a signed-out visitor never needed onboarding
  // to begin with (brief §2 read-only browsing). This replaces the redirect RequireAuth used
  // to do, now that the page itself is open to anonymous visitors.
  useEffect(() => {
    if (authLoading) return;
    if (profile && !profile.onboarding_completed) router.replace("/onboarding");
  }, [authLoading, profile, router]);

  const [events, setEvents] = useState<EventCardData[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [categoryId, setCategoryId] = useState<string | null>(searchParams.get("kategorie"));
  const [loading, setLoading] = useState(true);
  const [muniName, setMuniName] = useState<string>("");

  // Which municipality's events are being browsed — independent of a signed-in user's home
  // municipality (see brief note above). Loaded once on mount; every municipality (whether the
  // switcher will ever need it or not) is fetched up front since the map needs all the pins anyway.
  const [allMunicipalities, setAllMunicipalities] = useState<Pick<MunicipalityRow, "id" | "name" | "lat" | "lng">[]>([]);
  const [viewingMunicipalityId, setViewingMunicipalityId] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  useEffect(() => {
    listMunicipalities().then(setAllMunicipalities);
    try {
      setViewingMunicipalityId(sessionStorage.getItem(VIEWING_MUNICIPALITY_KEY));
    } catch {
      // sessionStorage unavailable (private mode etc.) — just re-picks every visit.
    }
  }, []);

  const switchMunicipality = (id: string) => {
    setViewingMunicipalityId(id);
    try {
      sessionStorage.setItem(VIEWING_MUNICIPALITY_KEY, id);
    } catch {
      // ignore — selection just won't persist across a reload
    }
    setSwitcherOpen(false);
  };

  const municipalityId = viewingMunicipalityId ?? profile?.municipality_id ?? null;

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
      if (!municipalityId) {
        setLoading(false);
        return;
      }

      const [muni, cats, ev, counts] = await Promise.all([
        getMunicipality(municipalityId),
        getEventCategories(),
        getUpcomingEvents(municipalityId),
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
          categories: e.category_ids.map((id) => catMap.get(id)).filter((c): c is Category => Boolean(c)),
        }));
      setEvents(mapped);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [municipalityId]);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      // Brief §2 "Jedna akce může mít víc kategorií zároveň" — matches if the event has this
      // category among possibly several, not just as its single category.
      if (categoryId && !(e.categories ?? []).some((c) => c.id === categoryId)) return false;
      if (filter === "today") return isToday(e.date_time);
      if (filter === "week") return isThisWeek(e.date_time);
      return true;
    });
  }, [events, filter, categoryId]);

  const recommended = useMemo(() => {
    // Brief §7 "doporučené akce na základě druhu... ukládat u uživatele data o typu...
    // aktivity" — events matching a stored interest (from onboarding) sort first, then
    // everything else by how soon it is. Free capacity is still a hard filter either way.
    const interestIds = new Set(profile?.interests ?? []);
    return [...events]
      .filter((e) => (e.registrations_count ?? 0) < e.capacity)
      .sort((a, b) => {
        const aMatches = (a.categories ?? []).some((c) => interestIds.has(c.id));
        const bMatches = (b.categories ?? []).some((c) => interestIds.has(c.id));
        if (aMatches !== bMatches) return aMatches ? -1 : 1;
        return new Date(a.date_time).getTime() - new Date(b.date_time).getTime();
      })
      .slice(0, 3);
  }, [events, profile?.interests]);

  if (isSuperAdmin || authLoading) return <Loading />;

  const switcherDialog = (
    <Dialog open={switcherOpen} onOpenChange={setSwitcherOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vyberte obec</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Obce, které používají Lonvitu. Vyberte, jejíž akce chcete procházet.
        </p>
        <MunicipalitiesMap
          points={allMunicipalities}
          selectedId={municipalityId}
          onSelect={switchMunicipality}
          className="h-72 w-full rounded-2xl overflow-hidden border border-border"
        />
      </DialogContent>
    </Dialog>
  );

  // Visitor (signed-out, or signed-in without a browsable municipality yet) who hasn't picked
  // one to browse (brief §2 read-only browsing).
  if (!municipalityId) {
    return (
      <div className="animate-fade-in px-4 pt-6">
        <h1 className="text-3xl font-extrabold leading-tight mb-1">Akce ve vaší obci</h1>
        <p className="text-muted-foreground mb-4">
          Vyberte obec a prohlédněte si její akce.{!user && " Přihlášení na akci vyžaduje účet."}
        </p>
        <MunicipalitiesMap
          points={allMunicipalities}
          onSelect={switchMunicipality}
          className="h-80 w-full rounded-2xl overflow-hidden border border-border"
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {switcherDialog}
      {/* Header */}
      <header className="px-4 pt-6 pb-4">
        <button
          onClick={() => setSwitcherOpen(true)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1 hover:text-foreground transition-colors"
        >
          <MapPin className="h-4 w-4" />
          <span className="font-semibold">{muniName || "Vaše obec"}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <h1 className="text-3xl font-extrabold leading-tight">Akce v obci</h1>
        <p className="text-muted-foreground mt-1">
          {user ? "Vyberte si akci a přihlaste se." : "Registrace na akci vyžaduje přihlášení."}
        </p>
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
    <Suspense fallback={<Loading />}>
      <IndexContent />
    </Suspense>
  );
}
