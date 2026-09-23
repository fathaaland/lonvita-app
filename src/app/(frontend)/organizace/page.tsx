"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import { toast } from "sonner";
import { Building2, Download, FileText, HandHeart, Hourglass, Pencil } from "lucide-react";
import {
  getEventCategories,
  getMyOrganizations,
  getOrganizationEvents,
  getOrganizationFeedbackSummary,
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
import { EventsTable } from "@/components/admin/EventsTable";
import { VolunteersTable } from "@/components/admin/VolunteersTable";
import { TypeChips } from "@/components/admin/OrganizationsTab";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EventRow, RegistrationRow, buildEventsCsv } from "@/lib/analytics";
import { isUnlimitedCapacity } from "@/lib/capacity";
import {
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

const formatDecimal = (value: number) => value.toLocaleString("cs-CZ", { maximumFractionDigits: 1 });
const formatPercent = (share: number) => `${Math.round(share * 100)} %`;

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
  const [saving, setSaving] = useState(false);

  const loadOrganizations = async () => {
    if (!user) return;
    const orgs = await getMyOrganizations(String(user.id), administeredMunicipalityIds).catch(() => []);
    setOrganizations(orgs);
    setSelectedId((current) => (current && orgs.some((o) => o.id === current) ? current : (orgs[0]?.id ?? null)));
  };

  useEffect(() => {
    loadOrganizations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, administeredKey]);

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

  const stats = useMemo(() => {
    const live = events.filter((e) => e.status !== "cancelled");
    const liveIds = new Set(live.map((e) => e.id));
    const approved = registrations.filter((r) => r.status === "approved" && liveIds.has(r.event_id));
    // Only where it still matters — a pending registration on a past event won't be approved anymore.
    const upcomingIds = new Set(live.filter((e) => new Date(e.date_time).getTime() >= Date.now()).map((e) => e.id));
    const pending = registrations.filter((r) => r.status === "pending" && upcomingIds.has(r.event_id));

    const perPerson = new Map<string, number>();
    for (const r of approved) perPerson.set(r.user_id, (perPerson.get(r.user_id) ?? 0) + 1);
    const returning = [...perPerson.values()].filter((n) => n >= 2).length;

    // "Bez omezení kapacity" would read as an empty event and drag the average down.
    const rates = live
      .filter((e) => e.capacity > 0 && !isUnlimitedCapacity(e.capacity))
      .map((e) => Math.min(1, approved.filter((r) => r.event_id === e.id).length / e.capacity));

    return {
      eventCount: live.length,
      coOrganizedCount: live.filter((e) => coOrganizedIds.has(e.id)).length,
      people: perPerson.size,
      returning,
      pending: pending.length,
      fillRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    };
  }, [events, registrations, coOrganizedIds]);

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
  const fileSlug = organization.name.replace(/\s+/g, "-");

  const openEdit = () => {
    setEditName(organization.name);
    setEditType(isOrganizationType(organization.type) ? organization.type : "individual");
    setEditOpen(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateMyOrganization(organization.id, { name: editName.trim(), type: editType });
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

  const handleExport = () => {
    const csv = buildEventsCsv(events, registrations, categories, []);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `organizace-${fileSlug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    const cats = new Map(categories.map((c) => [c.id, c.name]));
    const approved = registrations.filter((r) => r.status === "approved");
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const marginX = 48;
    let y = 56;

    const ensureSpace = (needed: number) => {
      if (y + needed > pdf.internal.pageSize.getHeight() - 48) {
        pdf.addPage();
        y = 56;
      }
    };

    pdf.setFont("helvetica", "bold").setFontSize(18);
    pdf.text(`Statistiky organizace — ${organization.name}`, marginX, y);
    y += 22;
    pdf.setFont("helvetica", "italic").setFontSize(10).setTextColor(102);
    pdf.text(`Vygenerováno ${new Date().toLocaleString("cs-CZ")}`, marginX, y);
    pdf.setTextColor(0);
    y += 26;

    pdf.setFont("helvetica", "bold").setFontSize(14);
    pdf.text("Klíčová čísla", marginX, y);
    y += 20;
    pdf.setFont("helvetica", "normal").setFontSize(10);
    [
      `Počet akcí: ${stats.eventCount} (spolupořádané: ${stats.coOrganizedCount})`,
      `Lidí na akcích: ${stats.people} (opakovaně: ${stats.returning})`,
      `Průměrná naplněnost: ${stats.fillRate === null ? "—" : formatPercent(stats.fillRate)}`,
      `Spokojenost: ${feedback?.avg_satisfaction == null ? "—" : `${formatDecimal(feedback.avg_satisfaction)} / 5 (${feedback.count} hodnocení)`}`,
    ].forEach((line) => {
      ensureSpace(16);
      pdf.text(line, marginX, y);
      y += 16;
    });
    y += 10;

    ensureSpace(20);
    pdf.setFont("helvetica", "bold").setFontSize(14);
    pdf.text("Přehled akcí", marginX, y);
    y += 18;

    const colWidths = [220, 110, 60, 60, 50];
    const colX = colWidths.map((_, i) => marginX + colWidths.slice(0, i).reduce((a, b) => a + b, 0));
    const drawRow = (cells: string[], bold: boolean) => {
      ensureSpace(16);
      pdf.setFont("helvetica", bold ? "bold" : "normal").setFontSize(9);
      cells.forEach((c, i) => pdf.text(c, colX[i], y, { maxWidth: colWidths[i] - 6 }));
      y += 16;
    };
    drawRow(["Název", "Kategorie", "Kapacita", "Schváleno", "Stav"], true);
    events.forEach((e) => {
      drawRow(
        [
          e.title,
          e.category_ids.map((id) => cats.get(id)).filter(Boolean).join(", "),
          String(e.capacity),
          String(approved.filter((r) => r.event_id === e.id).length),
          e.status,
        ],
        false,
      );
    });

    pdf.save(`organizace-${fileSlug}.pdf`);
    toast.success("PDF staženo.");
  };

  return (
    <div className="animate-fade-in sm:mx-auto sm:max-w-4xl">
      <PageHeader title="Organizace" />
      <div className="px-4 py-5 space-y-6">
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
          <OrganizationMark organization={organization} className="h-16 w-16 text-lg ring-0" />
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

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-bold">Akce organizace</h3>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
                    <Download className="h-4 w-4" /> CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleExportPdf} className="gap-1.5">
                    <FileText className="h-4 w-4" /> PDF
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
              />
            </section>

            {events.some((e) => e.is_volunteering) && (
              <section className="space-y-2">
                <h3 className="font-bold flex items-center gap-2">
                  <HandHeart className="h-4 w-4 text-primary" /> Pool dobrovolníků obce
                </h3>
                <VolunteersTable municipalityId={obec ? organization.municipality_id : undefined} />
              </section>
            )}
          </>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={(open) => !saving && setEditOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upravit organizaci</DialogTitle>
            <DialogDescription>
              Pod tímto názvem vás lidé uvidí na kartách a v detailu vašich akcí.
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
        <OrganizationContent />
      </RequireRole>
    </RequireAuth>
  );
}
