"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getMunicipalityEventsForAdmin,
  getRegistrationsForEventIds,
  getAllCategoriesForAdmin,
  getMunicipalityProfilesForAdmin,
  getFeedbackForEventIds,
} from "@/integrations/payload/admin-queries";
import { getMunicipality, listMunicipalities, RulesForCreation } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth, RequireRole } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { EventRow, RegistrationRow, CategoryRow, FeedbackRow } from "@/lib/analytics";
import type { ProfileWithDob } from "@/lib/report";

function AdminContent() {
  const router = useRouter();
  const { user, profile, administeredMunicipalityIds } = useAuth();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileWithDob[]>([]);
  const [muniName, setMuniName] = useState<string>("");
  const [muniId, setMuniId] = useState<string>("");
  // Someone can administer several obce — they pick which one the dashboard shows.
  const [selectedMuniId, setSelectedMuniId] = useState<string>("");
  const [muniOptions, setMuniOptions] = useState<{ id: string; name: string }[]>([]);
  const [rulesForCreation, setRulesForCreation] = useState<RulesForCreation>("approved_organizers");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>("overview");
  // Brief §3 "i admin obce může sám organizovat akce a chce vidět jejich výkon zvlášť."
  const [scope, setScope] = useState<"all" | "mine">("all");

  const load = async () => {
    if (!user) return;
    // The municipalities this account actually administers ("municipality_admin" user-roles)
    // aren't necessarily their home municipality — a superadmin can grant that role for any
    // obec. Fall back to the home municipality only if no explicit grant is found.
    const muniId = selectedMuniId || administeredMunicipalityIds[0] || profile?.municipality_id;
    if (!muniId) return;
    setLoading(true);

    const [evRows, cats, muni, profsRows] = await Promise.all([
      getMunicipalityEventsForAdmin(muniId),
      getAllCategoriesForAdmin(),
      getMunicipality(muniId),
      getMunicipalityProfilesForAdmin(muniId),
    ]);

    const eventIds = evRows.map((e) => e.id);
    const [regRows, feedbackRows] = await Promise.all([
      eventIds.length ? getRegistrationsForEventIds(eventIds) : Promise.resolve([]),
      eventIds.length ? getFeedbackForEventIds(eventIds) : Promise.resolve([]),
    ]);

    setEvents(evRows);
    setRegistrations(regRows);
    setFeedback(feedbackRows);
    setCategories(cats);
    setProfiles(profsRows);
    setMuniName(muni?.name ?? "");
    setMuniId(muniId);
    setRulesForCreation(muni?.rules_for_creation ?? "approved_organizers");
    setLoading(false);
  };

  const administeredKey = administeredMunicipalityIds.join(",");
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id, profile?.municipality_id, selectedMuniId, administeredKey]);

  useEffect(() => {
    if (administeredMunicipalityIds.length < 2) {
      setMuniOptions([]);
      return;
    }
    listMunicipalities().then((all) =>
      setMuniOptions(
        all
          .filter((m) => administeredMunicipalityIds.includes(m.id))
          .map((m) => ({ id: m.id, name: m.name }))
          .sort((a, b) => a.name.localeCompare(b.name, "cs")),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [administeredKey]);

  const scopedEvents = useMemo(
    () => (scope === "mine" && user ? events.filter((e) => e.organizer_id === String(user.id)) : events),
    [events, scope, user],
  );
  const scopedRegistrations = useMemo(() => {
    if (scope !== "mine") return registrations;
    const ids = new Set(scopedEvents.map((e) => e.id));
    return registrations.filter((r) => ids.has(r.event_id));
  }, [registrations, scope, scopedEvents]);
  const scopedFeedback = useMemo(() => {
    if (scope !== "mine") return feedback;
    const regIds = new Set(scopedRegistrations.map((r) => r.id));
    return feedback.filter((f) => regIds.has(f.registration_id));
  }, [feedback, scope, scopedRegistrations]);

  if (loading) return <><PageHeader title="Administrace" back /><Loading /></>;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Přehled obce" back />
      <div className="px-4 py-5 md:flex md:gap-6 md:items-start">
        <AdminSideNav value={tab} onChange={setTab} />

        <div className="flex-1 min-w-0">
          {muniOptions.length > 1 && (
            <Select value={muniId} onValueChange={setSelectedMuniId}>
              <SelectTrigger className="h-11 mb-4 max-w-xs" aria-label="Obec">
                <SelectValue placeholder="Vyberte obec" />
              </SelectTrigger>
              <SelectContent>
                {muniOptions.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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
                feedback={scopedFeedback}
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
              <VolunteersTable municipalityId={muniId} />
            </TabsContent>

            <TabsContent value="requests" className="pt-4">
              <RequestsTable key={muniId} municipalityId={muniId} />
            </TabsContent>

            <TabsContent value="settings" className="pt-4">
              {muniId && <SettingsPanel key={muniId} municipalityId={muniId} initialRules={rulesForCreation} />}
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
