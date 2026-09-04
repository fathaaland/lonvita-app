"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { CalendarRange, Users, Target, Download, HandHeart } from "lucide-react";
import { EventRow, RegistrationRow, buildEventsCsv } from "@/lib/analytics";

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

  if (loading) return <><PageHeader title="Moje organizace" back /><Loading /></>;

  return (
    <div className="animate-fade-in">
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

        <Button variant="outline" onClick={handleExport} className="w-full h-11">
          <Download className="h-4 w-4" /> Exportovat CSV
        </Button>

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
