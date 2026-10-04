"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Building2, Download, FileText, Hourglass, Loader2, Pencil } from "lucide-react";
import {
  getEventCategories,
  getMyOrganizations,
  getOrganizationEvents,
  getOrganizationFeedbackSummary,
  removeOrganizationAvatar,
  setOrganizationAvatar,
  updateMyOrganization,
  type CategoryRow,
  type EventRow as QueryEventRow,
  type MyOrganizationRow,
  type OrganizationFeedbackSummary,
} from "@/integrations/payload/queries";
import { getRegistrationsForEventIds } from "@/integrations/payload/admin-queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth, RequireRole } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { OrganizationMark } from "@/components/EventCard";
import { CoOrganizingInvitations } from "@/components/CoOrganizingInvitations";
import { AvatarEditor } from "@/components/AvatarEditor";
import { OrganizationReviews } from "@/components/OrganizationReviews";
import { EventsTable } from "@/components/admin/EventsTable";
import { VolunteersTable } from "@/components/admin/VolunteersTable";
import { OrganizersDirectoryCard } from "@/components/OrganizersDirectoryCard";
import { TypeChips } from "@/components/admin/OrganizationsTab";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EventRow, RegistrationRow } from "@/lib/analytics";
import { computeOrganizationStats, formatDecimal, formatPercent } from "@/lib/organization-stats";
import { useExport } from "@/hooks/useExport";
import {
  ORGANIZATION_DESCRIPTION_MAX_LENGTH,
  ORGANIZATION_NAME_MAX_LENGTH,
  isMunicipalityOrganization,
  isOrganizationType,
  organizationTypeLabel,
  type OrganizationType,
} from "@/lib/organizations";
import { cn } from "@/lib/utils";

function toAnalyticsEvent(e: QueryEventRow): EventRow {
  return {
    id: e.id,
    title: e.title,
    date_time: e.date_time,
    capacity: e.capacity,
    status: e.status ?? "active",
    category_ids: e.category_ids,
    organizer_id: e.organizer_id ?? "",
    created_at: e.date_time,
    is_paid: e.is_paid,
    price_cents: e.price_cents,
    is_volunteering: e.is_volunteering,
    locked_for_viewer: e.locked_for_viewer,
    deletion_needs_consent: e.deletion_needs_consent,
  };
}

function pendingLabel(count: number): string {
  if (count === 1) return "Na schválení čeká 1 přihláška";
  if (count >= 2 && count <= 4) return `Na schválení čekají ${count} přihlášky`;
  return `Na schválení čeká ${count} přihlášek`;
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <p className="text-sm font-semibold text-muted-foreground">{label}</p>
        <p className="text-3xl font-extrabold tabular-nums leading-none">{value}</p>
        <p className="text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

/** One line of what the participants said — a bar filled to `share` (0..1). */
function Meter({ label, share, value }: { label: string; share: number; value: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold">{label}</span>
        <span className="font-bold tabular-nums">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-brand-sand-pale overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
    </div>
  );
}

function OrganizationContent() {
  const { user, administeredMunicipalityIds } = useAuth();
  const administeredKey = administeredMunicipalityIds.join(",");
  const requestedId = useSearchParams().get("organizace");

  const [organizations, setOrganizations] = useState<MyOrganizationRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rawEvents, setRawEvents] = useState<QueryEventRow[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [feedback, setFeedback] = useState<OrganizationFeedbackSummary | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<OrganizationType>("individual");
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const exporter = useExport();

  const loadOrganizations = async () => {
    if (!user) return;
    const orgs = await getMyOrganizations(String(user.id), administeredMunicipalityIds).catch(() => []);
    setOrganizations(orgs);
    // "?organizace=<id>" — a notification about one of them (e.g. the obec just approved it).
    setSelectedId((current) => {
      if (requestedId && orgs.some((o) => o.id === requestedId)) return requestedId;
      return current && orgs.some((o) => o.id === current) ? current : (orgs[0]?.id ?? null);
    });
  };

  useEffect(() => {
    loadOrganizations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, administeredKey, requestedId]);

  const loadData = async (organizationId: string) => {
    setLoadingData(true);
    const [events, cats, summary] = await Promise.all([
      getOrganizationEvents(organizationId).catch(() => []),
      getEventCategories().catch(() => [] as CategoryRow[]),
      getOrganizationFeedbackSummary(organizationId).catch(() => null),
    ]);
    const regs = events.length
      ? await getRegistrationsForEventIds(events.map((e) => e.id)).catch(() => [] as RegistrationRow[])
      : [];
    setRawEvents(events);
    setCategories(cats);
    setFeedback(summary);
    setRegistrations(regs);
    setLoadingData(false);
  };

  useEffect(() => {
    if (selectedId) loadData(selectedId);
  }, [selectedId]);

  const organization = organizations?.find((o) => o.id === selectedId) ?? null;
  const events = useMemo(() => rawEvents.map(toAnalyticsEvent), [rawEvents]);
  const coOrganizedIds = useMemo(
    () => new Set(rawEvents.filter((e) => e.organization?.id !== selectedId).map((e) => e.id)),
    [rawEvents, selectedId],
  );

  const stats = useMemo(
    () => computeOrganizationStats(events, registrations, coOrganizedIds),
    [events, registrations, coOrganizedIds],
  );

  if (!organizations) return <><PageHeader title="Organizace" /><Loading /></>;

  if (!organization) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Organizace" />
        <EmptyState
          icon={Building2}
          title="Zatím nemáte organizaci"
          description="Organizaci dostanete se schválením role pořadatele. Požádat o ni můžete v profilu."
        />
      </div>
    );
  }

  const obec = isMunicipalityOrganization(organization);

  const openEdit = () => {
    setEditName(organization.name);
    setEditType(isOrganizationType(organization.type) ? organization.type : "individual");
    setEditDescription(organization.description ?? "");
    setEditOpen(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateMyOrganization(organization.id, {
        name: editName.trim(),
        type: editType,
        description: editDescription.trim(),
      });
      toast.success("Organizace uložena.");
      setEditOpen(false);
      await loadOrganizations();
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status < 500 ? error.message : "Organizaci se nepodařilo uložit.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleExport = (format: "csv" | "pdf") =>
    exporter.start({ kind: "organization-report", format, params: { organizationId: organization.id } });

  return (
    <div className="animate-fade-in sm:mx-auto sm:max-w-4xl">
      <PageHeader title="Organizace" />
      <div className="px-4 py-5 space-y-6">
        <CoOrganizingInvitations userId={String(user!.id)} onAccepted={() => loadData(organization.id)} />

        {organizations.length > 1 && (
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" role="tablist" aria-label="Vaše organizace">
            {organizations.map((o) => (
              <button
                key={o.id}
                type="button"
                role="tab"
                aria-selected={o.id === selectedId}
                onClick={() => setSelectedId(o.id)}
                className={cn(
                  "shrink-0 flex items-center gap-2 rounded-full border-[1.5px] py-1.5 pl-1.5 pr-4 text-sm font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  o.id === selectedId
                    ? "border-primary bg-brand-purple-pale text-brand-purple-dark"
                    : "border-border bg-card hover:border-brand-purple",
                )}
              >
                <OrganizationMark organization={o} className="ring-0" />
                {o.name}
              </button>
            ))}
          </div>
        )}

        <section className="flex items-center gap-4">
          {/* The owner — or, for the obec's own, its admins — sets the photo every event shows with it. */}
          {organization.is_own || obec ? (
            <AvatarEditor
              current={organization.avatar_url}
              renderAvatar={(src, size) => (
                <OrganizationMark
                  organization={{ ...organization, avatar_url: src }}
                  className={size === "header" ? "h-16 w-16 text-lg ring-0" : "h-40 w-40 text-4xl ring-0"}
                />
              )}
              title="Fotka organizace"
              description="Logo nebo fotka — ukáže se u všech akcí, které organizace pořádá nebo spolupořádá."
              editLabel="Změnit fotku organizace"
              onSave={(file) => setOrganizationAvatar(organization.id, file, organization.name)}
              onRemove={() => removeOrganizationAvatar(organization.id)}
              onChanged={loadOrganizations}
            />
          ) : (
            <OrganizationMark organization={organization} className="h-16 w-16 text-lg ring-0" />
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl sm:text-3xl font-extrabold leading-tight break-words">{organization.name}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {obec
                ? "Organizace obce — pod ní pořádáte akce obce"
                : `${organizationTypeLabel(organization.type)} v obci ${organization.municipality_name}`}
            </p>
          </div>
          {organization.is_own && (
            <Button variant="outline" size="sm" onClick={openEdit} className="shrink-0 gap-1.5">
              <Pencil className="h-4 w-4" /> <span className="sr-only sm:not-sr-only">Upravit</span>
            </Button>
          )}
        </section>

        {!obec &&
          (organization.description ? (
            <p className="-mt-2 max-w-prose whitespace-pre-line text-foreground/85">{organization.description}</p>
          ) : (
            organization.is_own && (
              <button
                type="button"
                onClick={openEdit}
                className="-mt-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                Přidat popis organizace
              </button>
            )
          ))}

        {loadingData ? (
          <Loading />
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat
                label="Akce"
                value={String(stats.eventCount)}
                note={
                  stats.coOrganizedCount > 0
                    ? `z toho ${stats.coOrganizedCount} jako spolupořadatel`
                    : "všechny ve vlastní režii"
                }
              />
              <Stat
                label="Lidí na akcích"
                value={String(stats.people)}
                note={stats.returning > 0 ? `${stats.returning} z nich opakovaně` : "zatím nikdo opakovaně"}
              />
              <Stat
                label="Naplněnost"
                value={stats.fillRate === null ? "—" : formatPercent(stats.fillRate)}
                note="průměr akcí s omezenou kapacitou"
              />
              <Stat
                label="Spokojenost"
                value={feedback?.avg_satisfaction == null ? "—" : formatDecimal(feedback.avg_satisfaction)}
                note={feedback && feedback.count > 0 ? `z 5, podle ${feedback.count} hodnocení` : "zatím nikdo nehodnotil"}
              />
            </div>

            {feedback && feedback.count > 0 && (
              <Card>
                <CardContent className="p-4 sm:p-5 space-y-4">
                  <h3 className="font-bold">Co říkají účastníci</h3>
                  <div className="grid gap-4 sm:grid-cols-3">
                    {feedback.avg_felt_welcome !== null && (
                      <Meter
                        label="Cítili se vítáni"
                        share={feedback.avg_felt_welcome / 5}
                        value={`${formatDecimal(feedback.avg_felt_welcome)} z 5`}
                      />
                    )}
                    {feedback.met_someone_new_share !== null && (
                      <Meter
                        label="Poznali někoho nového"
                        share={feedback.met_someone_new_share}
                        value={formatPercent(feedback.met_someone_new_share)}
                      />
                    )}
                    {feedback.came_alone_share !== null && (
                      <Meter
                        label="Přišli sami"
                        share={feedback.came_alone_share}
                        value={formatPercent(feedback.came_alone_share)}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            <OrganizationReviews organizationId={organization.id} />

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-bold">Akce organizace</h3>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExport("csv")}
                    disabled={exporter.pending !== null}
                    className="gap-1.5"
                  >
                    {exporter.pending === "organization-report:csv"
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Download className="h-4 w-4" />} CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExport("pdf")}
                    disabled={exporter.pending !== null}
                    className="gap-1.5"
                  >
                    {exporter.pending === "organization-report:pdf"
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <FileText className="h-4 w-4" />} PDF
                  </Button>
                </div>
              </div>
              {stats.pending > 0 && (
                <p className="flex items-center gap-2 rounded-xl bg-brand-purple-pale px-3 py-2.5 text-sm text-brand-purple-dark">
                  <Hourglass className="h-4 w-4 shrink-0" />
                  <span>
                    <span className="font-semibold">{pendingLabel(stats.pending)}.</span> Potvrdíte je v detailu akce.
                  </span>
                </p>
              )}
              <EventsTable
                events={events}
                registrations={registrations}
                categories={categories}
                profiles={[]}
                onDeleted={() => loadData(organization.id)}
                tagFor={(e) => (coOrganizedIds.has(e.id) ? "Spolupořádáte" : null)}
                viewerId={String(user!.id)}
              />
            </section>

            <section aria-label="Organizátoři v obci">
              <OrganizersDirectoryCard
                municipalityId={organization.municipality_id}
                municipalityName={organization.municipality_name}
                organizationId={organization.id}
              />
            </section>

            <section aria-label="Pool dobrovolníků">
              <VolunteersTable />
            </section>
          </>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={(open) => !saving && setEditOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upravit organizaci</DialogTitle>
            <DialogDescription>
              Pod tímto názvem vás lidé uvidí na kartách a v detailu vašich akcí. Popis se ukáže ostatním pořadatelům
              v obci.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <Label>Typ</Label>
              <TypeChips value={editType} onChange={setEditType} />
            </div>
            <div>
              <Label htmlFor="org-name">Název</Label>
              <Input
                id="org-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={ORGANIZATION_NAME_MAX_LENGTH}
                className="h-11 mt-1.5"
                required
              />
            </div>
            <div>
              <Label htmlFor="org-description">Popis</Label>
              <Textarea
                id="org-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                maxLength={ORGANIZATION_DESCRIPTION_MAX_LENGTH}
                rows={5}
                placeholder="Kdo jste a jaké akce pořádáte — třeba „Kavárna na náměstí, pořádáme čtení a odpolední setkání u kávy.“"
                className="mt-1.5"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Uvidí ho ostatní pořadatelé a admin obce v přehledu Organizátoři v mém městě.
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
                Zrušit
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Ukládám…" : "Uložit"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function OrganizationPage() {
  return (
    <RequireAuth>
      <RequireRole role="organizer">
        <Suspense fallback={<Loading />}>
          <OrganizationContent />
        </Suspense>
      </RequireRole>
    </RequireAuth>
  );
}
