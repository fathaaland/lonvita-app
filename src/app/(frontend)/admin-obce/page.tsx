"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getMunicipalityEventsForAdmin,
  getRegistrationsForEventIds,
  getAllCategoriesForAdmin,
  getMunicipalityProfilesForAdmin,
} from "@/integrations/payload/admin-queries";
import { getMunicipality, getMyAdministeredMunicipalityId, RulesForCreation } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth, RequireRole } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BarChart3, CalendarRange, HandHeart, ClipboardList, Settings } from "lucide-react";
import { AnalyticsOverview } from "@/components/admin/AnalyticsOverview";
import { EventsTable } from "@/components/admin/EventsTable";
import { CommunityReport } from "@/components/admin/CommunityReport";
import { VolunteersTable } from "@/components/admin/VolunteersTable";
import { RequestsTable } from "@/components/admin/RequestsTable";
import { SettingsPanel } from "@/components/admin/SettingsPanel";
import { AdminSideNav } from "@/components/admin/AdminSideNav";
import { cn } from "@/lib/utils";
import { EventRow, RegistrationRow, CategoryRow } from "@/lib/analytics";
import type { ProfileWithDob } from "@/lib/report";

function AdminContent() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileWithDob[]>([]);
  const [muniName, setMuniName] = useState<string>("");
  const [muniId, setMuniId] = useState<string>("");
  const [rulesForCreation, setRulesForCreation] = useState<RulesForCreation>("approved_organizers");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>("overview");
  // Brief §3 "i admin obce může sám organizovat akce a chce vidět jejich výkon zvlášť."
  const [scope, setScope] = useState<"all" | "mine">("all");

  const load = async () => {
    if (!user) return;
    // The municipality this account actually administers (a "municipality_admin" user-role)
    // isn't necessarily their home municipality — a superadmin can grant that role for any
    // obec. Fall back to the home municipality only if no explicit grant is found.
    const muniId = (await getMyAdministeredMunicipalityId(String(user.id))) ?? profile?.municipality_id;
    if (!muniId) return;
    setLoading(true);

    const [evRows, cats, muni, profsRows] = await Promise.all([
      getMunicipalityEventsForAdmin(muniId),
      getAllCategoriesForAdmin(),
      getMunicipality(muniId),
      getMunicipalityProfilesForAdmin(muniId),
    ]);

    const regRows = evRows.length ? await getRegistrationsForEventIds(evRows.map((e) => e.id)) : [];

    setEvents(evRows);
    setRegistrations(regRows);
    setCategories(cats);
    setProfiles(profsRows);
    setMuniName(muni?.name ?? "");
    setMuniId(muniId);
    setRulesForCreation(muni?.rules_for_creation ?? "approved_organizers");
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id, profile?.municipality_id]);

  const scopedEvents = useMemo(
    () => (scope === "mine" && user ? events.filter((e) => e.organizer_id === String(user.id)) : events),
    [events, scope, user],
  );
  const scopedRegistrations = useMemo(() => {
    if (scope !== "mine") return registrations;
    const ids = new Set(scopedEvents.map((e) => e.id));
    return registrations.filter((r) => ids.has(r.event_id));
  }, [registrations, scope, scopedEvents]);

  if (loading) return <><PageHeader title="Administrace" back /><Loading /></>;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Přehled obce" back />
      <div className="px-4 py-5 md:flex md:gap-6 md:items-start">
        <AdminSideNav value={tab} onChange={setTab} />

        <div className="flex-1 min-w-0">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full h-12 grid grid-cols-5 md:hidden">
              <TabsTrigger value="overview" className="gap-1">
                <BarChart3 className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="events" className="gap-1">
                <CalendarRange className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="volunteers" className="gap-1">
                <HandHeart className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="requests" className="gap-1">
                <ClipboardList className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-1">
                <Settings className="h-4 w-4" />
              </TabsTrigger>
            </TabsList>

            {(tab === "overview" || tab === "events") && (
              <div className="flex gap-1 bg-muted rounded-lg p-1 mt-4 max-w-xs">
                {([
                  { v: "all" as const, label: "Celá obec" },
                  { v: "mine" as const, label: "Jen moje akce" },
                ]).map((opt) => (
                  <button
                    key={opt.v}
                    onClick={() => setScope(opt.v)}
                    className={cn(
                      "flex-1 h-9 rounded-md text-sm font-semibold transition-colors",
                      scope === opt.v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            <TabsContent value="overview" className="pt-4 space-y-4">
              <div className="flex justify-end">
                <CommunityReport
                  events={scopedEvents}
                  registrations={scopedRegistrations}
                  profiles={profiles}
                  municipalityName={muniName}
                />
              </div>
              <AnalyticsOverview
                events={scopedEvents}
                registrations={scopedRegistrations}
                categories={categories}
                profiles={profiles}
                municipalityName={muniName}
              />
            </TabsContent>

            <TabsContent value="events" className="pt-4">
              <EventsTable
                events={scopedEvents}
                registrations={scopedRegistrations}
                categories={categories}
                profiles={profiles}
                onDeleted={load}
              />
            </TabsContent>

            <TabsContent value="volunteers" className="pt-4">
              <VolunteersTable />
            </TabsContent>

            <TabsContent value="requests" className="pt-4">
              <RequestsTable />
            </TabsContent>

            <TabsContent value="settings" className="pt-4">
              {muniId && <SettingsPanel municipalityId={muniId} initialRules={rulesForCreation} />}
            </TabsContent>
          </Tabs>

          <Button onClick={() => router.push("/")} variant="outline" className="w-full h-12 mt-6 md:hidden">Zpět na úvod</Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <RequireAuth>
      <RequireRole role="municipality_admin">
        <AdminContent />
      </RequireRole>
    </RequireAuth>
  );
}
