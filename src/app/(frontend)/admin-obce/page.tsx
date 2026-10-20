"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getMunicipalityDashboard,
  getPendingRequestCountForAdmin,
  type MunicipalityDashboardData,
} from "@/integrations/payload/admin-queries";
import { getMunicipality, listMunicipalities, RulesForCreation } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth, RequireRole } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BarChart3, CalendarRange, HandHeart, ClipboardList, Download, Settings } from "lucide-react";
import { AnalyticsOverview } from "@/components/admin/AnalyticsOverview";
import { EventsTable } from "@/components/admin/EventsTable";
import { CommunityReport } from "@/components/admin/CommunityReport";
import { VolunteersTable } from "@/components/admin/VolunteersTable";
import { PoolInvitationsCard } from "@/components/admin/PoolInvitationsCard";
import { RequestsTable } from "@/components/admin/RequestsTable";
import { SettingsPanel } from "@/components/admin/SettingsPanel";
import { ImportPanel } from "@/components/admin/ImportPanel";
import { countPendingImportCandidates } from "@/integrations/payload/import-queries";
import { ADMIN_NAV, AdminSideNav } from "@/components/admin/AdminSideNav";
import { cn } from "@/lib/utils";
import { UnreadBadge } from "@/components/UnreadBadge";

function AdminContent() {
  const router = useRouter();
  const { user, profile, administeredMunicipalityIds } = useAuth();
  // The numbers, worked out on the server — the page no longer downloads the obec's registrations.
  const [dashboard, setDashboard] = useState<MunicipalityDashboardData | null>(null);
  const [muniName, setMuniName] = useState<string>("");
  const [muniId, setMuniId] = useState<string>("");
  // Someone can administer several obce — they pick which one the dashboard shows.
  const [selectedMuniId, setSelectedMuniId] = useState<string>("");
  const [muniOptions, setMuniOptions] = useState<{ id: string; name: string }[]>([]);
  const [rulesForCreation, setRulesForCreation] = useState<RulesForCreation>("approved_organizers");
  const [loading, setLoading] = useState(true);
  const [pendingRequests, setPendingRequests] = useState(0);
  // Imported events waiting to be taken over (ImportPanel).
  const [pendingImports, setPendingImports] = useState(0);
  // A notification can open a section straight away — e.g. "?tab=requests" for something waiting
  // on the obec's approval.
  const tabParam = useSearchParams().get("tab");
  const [tab, setTab] = useState<string>(
    tabParam && ADMIN_NAV.some((item) => item.value === tabParam) ? tabParam : "overview",
  );
  useEffect(() => {
    if (tabParam && ADMIN_NAV.some((item) => item.value === tabParam)) setTab(tabParam);
  }, [tabParam]);
  // Brief §3 "i admin obce může sám organizovat akce a chce vidět jejich výkon zvlášť."
  const [scope, setScope] = useState<"all" | "mine">("all");

  // Only the latest request lands — a quick "Celá obec" → "Jen moje akce" → back mustn't end on
  // whichever answer happened to arrive last.
  const latestLoad = useRef(0);

  const load = async () => {
    if (!user) return;
    // The municipalities this account actually administers ("municipality_admin" user-roles)
    // aren't necessarily their home municipality — a superadmin can grant that role for any
    // obec. Fall back to the home municipality only if no explicit grant is found.
    const targetId = selectedMuniId || administeredMunicipalityIds[0] || profile?.municipality_id;
    if (!targetId) return;
    const request = ++latestLoad.current;
    // The whole page waits only for another obec; switching the scope keeps the numbers on screen
    // until the new ones arrive.
    if (targetId !== muniId || !dashboard) setLoading(true);

    const [data, muni, pendingCount, importCount] = await Promise.all([
      getMunicipalityDashboard(targetId, scope),
      getMunicipality(targetId),
      getPendingRequestCountForAdmin(targetId),
      countPendingImportCandidates(targetId).catch(() => 0),
    ]);
    if (request !== latestLoad.current) return;

    setDashboard(data);
    setPendingRequests(pendingCount);
    setPendingImports(importCount);
    setMuniName(muni?.name ?? "");
    setMuniId(targetId);
    setRulesForCreation(muni?.rules_for_creation ?? "approved_organizers");
    setLoading(false);
  };

  const administeredKey = administeredMunicipalityIds.join(",");
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id, profile?.municipality_id, selectedMuniId, administeredKey, scope]);

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

  if (loading || !dashboard) return <><PageHeader title="Administrace" back /><Loading /></>;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Přehled obce" back />
      <div className="px-4 py-5 md:flex md:gap-6 md:items-start">
        <AdminSideNav value={tab} onChange={setTab} badges={{ requests: pendingRequests, import: pendingImports }} />

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
            <TabsList className="w-full h-12 grid grid-cols-6 md:hidden">
              <TabsTrigger value="overview" className="gap-1" aria-label="Přehled">
                <BarChart3 className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="events" className="gap-1" aria-label="Akce">
                <CalendarRange className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="volunteers" className="gap-1" aria-label="Dobrovolníci">
                <HandHeart className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger
                value="requests"
                className="relative gap-1"
                aria-label={pendingRequests > 0 ? `Žádosti, čeká na vyřízení: ${pendingRequests}` : "Žádosti"}
              >
                <ClipboardList className="h-4 w-4" />
                <UnreadBadge count={pendingRequests} className="-top-1 right-1" ringClassName="ring-muted" />
              </TabsTrigger>
              <TabsTrigger
                value="import"
                className="relative gap-1"
                aria-label={pendingImports > 0 ? `Import akcí, čeká na převzetí: ${pendingImports}` : "Import akcí"}
              >
                <Download className="h-4 w-4" />
                <UnreadBadge count={pendingImports} className="-top-1 right-1" ringClassName="ring-muted" />
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-1" aria-label="Nastavení">
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
                  metrics={dashboard.report}
                  municipalityName={muniName}
                  municipalityId={muniId}
                  scope={scope}
                />
              </div>
              <AnalyticsOverview
                dashboard={dashboard}
                municipalityName={muniName}
                municipalityId={muniId}
                scope={scope}
              />
            </TabsContent>

            <TabsContent value="events" className="pt-4">
              <EventsTable
                events={dashboard.events}
                categories={dashboard.categories}
                onDeleted={load}
                viewerId={String(user?.id ?? "")}
              />
            </TabsContent>

            <TabsContent value="volunteers" className="pt-4 space-y-4">
              <VolunteersTable />
              <PoolInvitationsCard key={muniId} municipalityId={muniId} />
            </TabsContent>

            <TabsContent value="requests" className="pt-4">
              <RequestsTable key={muniId} municipalityId={muniId} onPendingCountChange={setPendingRequests} />
            </TabsContent>

            <TabsContent value="import" className="pt-4">
              {muniId && <ImportPanel key={muniId} municipalityId={muniId} onPendingCountChange={setPendingImports} />}
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
        <Suspense fallback={<Loading />}>
          <AdminContent />
        </Suspense>
      </RequireRole>
    </RequireAuth>
  );
}
