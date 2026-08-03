"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getMunicipalityEventsForAdmin,
  getRegistrationsForEventIds,
  getAllCategoriesForAdmin,
  getMunicipalityProfilesForAdmin,
  getPendingOrganizerRequests,
  decideOrganizerRequest,
  updateMunicipalityRule,
  AdminRequestRow,
} from "@/integrations/payload/admin-queries";
import { getMunicipality } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth, RequireRole } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Settings as SettingsIcon, Check, X, BarChart3, ClipboardList, CalendarRange, Wallet, HandHeart } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AnalyticsOverview } from "@/components/admin/AnalyticsOverview";
import { EventsTable } from "@/components/admin/EventsTable";
import { FinanceOverview } from "@/components/admin/FinanceOverview";
import { CommunityReport } from "@/components/admin/CommunityReport";
import { VolunteersTable } from "@/components/admin/VolunteersTable";
import { AdminSideNav } from "@/components/admin/AdminSideNav";
import { EventRow, RegistrationRow, CategoryRow } from "@/lib/analytics";
import type { ProfileWithDob } from "@/lib/report";

type Request = AdminRequestRow;

function AdminContent() {
  const router = useRouter();
  const { profile } = useAuth();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileWithDob[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [muniName, setMuniName] = useState<string>("");
  const [rule, setRule] = useState<string>("approved_organizers");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>("overview");

  const load = async () => {
    if (!profile?.municipality_id) return;
    setLoading(true);
    const muniId = profile.municipality_id;

    const [evRows, cats, muni, reqRows, profsRows] = await Promise.all([
      getMunicipalityEventsForAdmin(muniId),
      getAllCategoriesForAdmin(),
      getMunicipality(muniId),
      getPendingOrganizerRequests(muniId),
      getMunicipalityProfilesForAdmin(muniId),
    ]);

    const regRows = evRows.length ? await getRegistrationsForEventIds(evRows.map((e) => e.id)) : [];

    setEvents(evRows);
    setRegistrations(regRows);
    setCategories(cats);
    setProfiles(profsRows);
    setRequests(reqRows);
    setMuniName(muni?.name ?? "");
    if (muni?.rules_for_creation) setRule(muni.rules_for_creation);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [profile?.municipality_id]);

  const decide = async (req: Request, approve: boolean) => {
    if (!profile?.municipality_id) return;
    try {
      await decideOrganizerRequest(req.id, req.user_id, profile.municipality_id, approve);
      toast.success(approve ? "Žádost schválena." : "Žádost zamítnuta.");
      load();
    } catch {
      toast.error("Nepodařilo se uložit rozhodnutí.");
    }
  };

  const updateRule = async (newRule: string) => {
    if (!profile?.municipality_id) return;
    setRule(newRule);
    await updateMunicipalityRule(profile.municipality_id, newRule as "anyone" | "approved_organizers" | "municipality_only");
    toast.success("Pravidla aktualizována.");
  };

  if (loading) return <><PageHeader title="Administrace" back /><Loading /></>;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Přehled obce" back />
      <div className="px-4 py-5 md:flex md:gap-6 md:items-start">
        <AdminSideNav value={tab} onChange={setTab} requestCount={requests.length} />

        <div className="flex-1 min-w-0">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full h-12 grid grid-cols-6 md:hidden">
              <TabsTrigger value="overview" className="gap-1">
                <BarChart3 className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="events" className="gap-1">
                <CalendarRange className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="finance" className="gap-1">
                <Wallet className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="volunteers" className="gap-1">
                <HandHeart className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="requests" className="gap-1 relative">
                <ClipboardList className="h-4 w-4" />
                {requests.length > 0 && (
                  <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                    {requests.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-1">
                <SettingsIcon className="h-4 w-4" />
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="pt-4 space-y-4">
              <div className="flex justify-end">
                <CommunityReport
                  events={events}
                  registrations={registrations}
                  profiles={profiles}
                  municipalityName={muniName}
                />
              </div>
              <AnalyticsOverview
                events={events}
                registrations={registrations}
                categories={categories}
                profiles={profiles}
                municipalityName={muniName}
              />
            </TabsContent>

            <TabsContent value="events" className="pt-4">
              <EventsTable
                events={events}
                registrations={registrations}
                categories={categories}
                profiles={profiles}
              />
            </TabsContent>

            <TabsContent value="finance" className="pt-4">
              <FinanceOverview
                events={events}
                registrations={registrations}
                municipalityName={muniName}
              />
            </TabsContent>

            <TabsContent value="volunteers" className="pt-4">
              <VolunteersTable />
            </TabsContent>

            <TabsContent value="requests" className="pt-4 space-y-3">
              {requests.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Žádné čekající žádosti.</p>
              ) : requests.map((r) => (
                <Card key={r.id}><CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-9 w-9"><AvatarFallback className="bg-primary text-primary-foreground text-sm">
                      {r.full_name.split(" ").map(p => p[0]).join("").slice(0, 2)}
                    </AvatarFallback></Avatar>
                    <p className="font-bold">{r.full_name}</p>
                  </div>
                  <p className="text-sm text-foreground/90">{r.description}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={() => decide(r, true)} className="h-11"><Check className="h-4 w-4" />Schválit</Button>
                    <Button onClick={() => decide(r, false)} variant="outline" className="h-11"><X className="h-4 w-4" />Zamítnout</Button>
                  </div>
                </CardContent></Card>
              ))}
            </TabsContent>

            <TabsContent value="settings" className="pt-4">
              <Card><CardContent className="p-4 space-y-3">
                <div className="eyebrow"><SettingsIcon className="h-3 w-3" /> Pravidla pro vytváření akcí</div>
                <Select value={rule} onValueChange={updateRule}>
                  <SelectTrigger className="h-12"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anyone">Kdokoliv může vytvářet</SelectItem>
                    <SelectItem value="approved_organizers">Pouze schválení pořadatelé</SelectItem>
                    <SelectItem value="municipality_only">Pouze obec</SelectItem>
                  </SelectContent>
                </Select>
              </CardContent></Card>
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
      <RequireRole role="admin">
        <AdminContent />
      </RequireRole>
    </RequireAuth>
  );
}
