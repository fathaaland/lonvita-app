"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { jsPDF } from "jspdf";
import {
  getMyOrganizedEvents,
  getEventCategories,
  EventRow as QueryEventRow,
  CategoryRow,
} from "@/integrations/payload/queries";
import { getRegistrationsForEventIds } from "@/integrations/payload/admin-queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth, RequireRole } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EventsTable } from "@/components/admin/EventsTable";
import { VolunteersTable } from "@/components/admin/VolunteersTable";
import { CalendarRange, Users, Target, Download, FileText, HandHeart } from "lucide-react";
import { EventRow, RegistrationRow, buildEventsCsv } from "@/lib/analytics";
import { toast } from "sonner";

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

function OrganizerDashboardContent() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const [rawEvents, cats] = await Promise.all([getMyOrganizedEvents(String(user.id)), getEventCategories()]);
    const mapped = rawEvents.map(toAnalyticsEvent);
    const regRows = mapped.length ? await getRegistrationsForEventIds(mapped.map((e) => e.id)) : [];
    setEvents(mapped);
    setRegistrations(regRows);
    setCategories(cats);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const approved = useMemo(() => registrations.filter((r) => r.status === "approved"), [registrations]);
  const pending = useMemo(() => registrations.filter((r) => r.status === "pending"), [registrations]);
  const avgFillRate = useMemo(() => {
    const rates = events.filter((e) => e.capacity > 0).map((e) => {
      const count = approved.filter((r) => r.event_id === e.id).length;
      return Math.min(1, count / e.capacity);
    });
    return rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) : 0;
  }, [events, approved]);
  const hasVolunteeringEvent = events.some((e) => e.is_volunteering);

  const handleExport = () => {
    const csv = buildEventsCsv(events, registrations, categories, []);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `moje-akce-${profile?.full_name ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    const cats = new Map(categories.map((c) => [c.id, c.name]));
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const marginX = 48;
    const pageWidth = pdf.internal.pageSize.getWidth();
    let y = 56;

    const ensureSpace = (needed: number) => {
      if (y + needed > pdf.internal.pageSize.getHeight() - 48) {
        pdf.addPage();
        y = 56;
      }
    };

    pdf.setFont("helvetica", "bold").setFontSize(18);
    pdf.text(`Statistiky pořadatele — ${profile?.full_name ?? ""}`, marginX, y);
    y += 22;
    pdf.setFont("helvetica", "italic").setFontSize(10).setTextColor(102);
    pdf.text(`Vygenerováno ${new Date().toLocaleString("cs-CZ")}`, marginX, y);
    pdf.setTextColor(0);
    y += 26;

    ensureSpace(20);
    pdf.setFont("helvetica", "bold").setFontSize(14);
    pdf.text("Klíčová čísla", marginX, y);
    y += 20;
    pdf.setFont("helvetica", "normal").setFontSize(10);
    [
      `Počet akcí: ${events.length}`,
      `Schválené přihlášky: ${approved.length} (čeká ${pending.length})`,
      `Průměrná naplněnost: ${avgFillRate} %`,
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
    const colX = [
      marginX,
      marginX + colWidths[0],
      marginX + colWidths[0] + colWidths[1],
      marginX + colWidths[0] + colWidths[1] + colWidths[2],
      marginX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3],
    ];
    const drawRow = (cells: string[], bold: boolean) => {
      ensureSpace(16);
      pdf.setFont("helvetica", bold ? "bold" : "normal").setFontSize(9);
      cells.forEach((c, i) => pdf.text(c, colX[i], y, { maxWidth: colWidths[i] - 6 }));
      y += 16;
    };
    drawRow(["Název", "Kategorie", "Kapacita", "Schváleno", "Stav"], true);
    events.forEach((e) => {
      const a = approved.filter((r) => r.event_id === e.id).length;
      drawRow(
        [
          e.title,
          e.category_ids.map((id) => cats.get(id)).filter(Boolean).join(", "),
          String(e.capacity),
          String(a),
          e.status,
        ],
        false,
      );
    });

    pdf.save(`moje-akce-${(profile?.full_name ?? "export").replace(/\s+/g, "-")}.pdf`);
    toast.success("PDF staženo.");
  };

  if (loading) return <><PageHeader title="Moje organizace" back /><Loading /></>;

  return (
    <div className="animate-fade-in sm:mx-auto sm:max-w-3xl">
      <PageHeader title="Moje organizace" subtitle="Přehled a statistiky vašich akcí" back />
      <div className="px-4 py-5 space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Card><CardContent className="p-3 space-y-1">
            <CalendarRange className="h-4 w-4 text-primary" />
            <p className="text-xl font-extrabold tabular-nums">{events.length}</p>
            <p className="text-xs text-muted-foreground">Akcí</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 space-y-1">
            <Users className="h-4 w-4 text-primary" />
            <p className="text-xl font-extrabold tabular-nums">{approved.length}</p>
            <p className="text-xs text-muted-foreground">Přihlášek · {pending.length} čeká</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 space-y-1">
            <Target className="h-4 w-4 text-primary" />
            <p className="text-xl font-extrabold tabular-nums">{avgFillRate} %</p>
            <p className="text-xs text-muted-foreground">Naplněnost</p>
          </CardContent></Card>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={handleExport} className="h-11">
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" onClick={handleExportPdf} className="h-11">
            <FileText className="h-4 w-4" /> PDF
          </Button>
        </div>

        <div>
          <p className="font-bold text-sm mb-2 px-1">Vaše akce</p>
          <EventsTable events={events} registrations={registrations} categories={categories} profiles={[]} onDeleted={load} />
        </div>

        {hasVolunteeringEvent && (
          <div>
            <div className="flex items-center gap-2 px-1 mb-2">
              <HandHeart className="h-4 w-4 text-primary" />
              <p className="font-bold text-sm">Pool dobrovolníků obce</p>
            </div>
            <VolunteersTable />
          </div>
        )}

        <Button onClick={() => router.push("/")} variant="outline" className="w-full h-12">Zpět na úvod</Button>
      </div>
    </div>
  );
}

export default function OrganizerDashboardPage() {
  return (
    <RequireAuth>
      <RequireRole role="organizer">
        <OrganizerDashboardContent />
      </RequireRole>
    </RequireAuth>
  );
}
