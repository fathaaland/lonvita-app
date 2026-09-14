"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getEvent,
  getMyAdministeredMunicipalityIds,
  requestVolunteerFlag,
  updateEvent,
  EventRow,
} from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { EventForm, EventFormValues } from "@/components/EventForm";
import { toast } from "sonner";

const CZECHIA_CENTER: [number, number] = [49.8175, 15.473];

/** Edit an existing event — its organizer/co-organizer, the admin of its obec, or a superadmin
 * (mirrors Events.access.update). Saving a change participants can see notifies every registrant
 * in-app, by e-mail and by SMS (Events.ts notifyRegistrantsOnEdit). */
function EditEventContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { user, isSuperAdmin } = useAuth();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [canSetVolunteering, setCanSetVolunteering] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !id) return;
    let active = true;
    (async () => {
      const [ev, adminIds] = await Promise.all([
        getEvent(id),
        getMyAdministeredMunicipalityIds(String(user.id)).catch(() => [] as string[]),
      ]);
      if (!active) return;
      if (ev) {
        const uid = String(user.id);
        const isAdminHere = isSuperAdmin || (!!ev.municipality_id && adminIds.includes(ev.municipality_id));
        setCanSetVolunteering(isAdminHere);
        setCanEdit(isAdminHere || ev.organizer_id === uid || ev.co_organizer_ids.includes(uid));
      }
      setEvent(ev);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [user?.id, id, isSuperAdmin]);

  const handleSubmit = async (values: EventFormValues) => {
    if (!user || !event) return;
    try {
      await updateEvent(event.id, {
        title: values.title,
        description: values.description,
        dateTime: values.dateTimeIso,
        endDateTime: values.endDateTimeIso,
        recurrenceRule: values.recurrenceRule,
        locationText: values.location.label,
        lat: values.location.lat,
        lng: values.location.lng,
        accessibilityTags: values.accessibilityTags,
        capacity: values.capacity,
        registrationApprovalMode: values.registrationApprovalMode,
        organization: values.organizationId ? Number(values.organizationId) : null,
        categories: values.categoryIds.map(Number),
        ...(values.imageId ? { image: Number(values.imageId) } : {}),
        imagePositionX: values.imagePosition.x,
        imagePositionY: values.imagePosition.y,
        isPaid: values.isPaid,
        priceCents: values.isPaid ? values.priceCents : null,
        ...(canSetVolunteering ? { isVolunteering: values.isVolunteering } : {}),
      });

      if (values.isVolunteering && !event.is_volunteering && !canSetVolunteering) {
        try {
          await requestVolunteerFlag(event.id, String(user.id));
          toast.success("Akce upravena, žádost o příznak Dobrovolnictví odeslána.");
        } catch {
          toast.success("Akce upravena.");
          toast.error("Žádost o příznak Dobrovolnictví se nepodařilo odeslat.");
        }
      } else {
        toast.success("Akce upravena. Přihlášení účastníci dostanou upozornění o změně.");
      }
      router.push(`/akce/${event.id}`);
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status === 400 ? error.message : "Nepodařilo se uložit změny.",
      );
    }
  };

  if (loading || !user) return <><PageHeader title="Upravit akci" back /><Loading /></>;

  if (!event || !canEdit) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Upravit akci" back />
        <EmptyState
          title={event ? "Tuto akci nemůžete upravit" : "Akce nebyla nalezena"}
          description={event ? "Upravovat ji může pořadatel nebo admin obce." : undefined}
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Upravit akci" back />
      <EventForm
        userId={String(user.id)}
        initial={event}
        municipalityCenter={event.lat != null && event.lng != null ? [event.lat, event.lng] : CZECHIA_CENTER}
        canSetVolunteering={canSetVolunteering}
        submitLabel="Uložit změny"
        onSubmit={handleSubmit}
      />
    </div>
  );
}

export default function EditEventPage() {
  return (
    <RequireAuth>
      <EditEventContent />
    </RequireAuth>
  );
}
