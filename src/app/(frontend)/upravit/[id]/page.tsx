"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getEvent,
  getMyAdministeredMunicipalityIds,
  getPendingCoOrganizers,
  updateEvent,
  EventRow,
  OrganizationRef,
} from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { EventForm, EventFormValues } from "@/components/EventForm";
import { VolunteeringCard } from "@/components/VolunteeringCard";
import { sendFollowUpRequests } from "@/lib/eventFollowUpRequests";
import { isMunicipalityOrganization } from "@/lib/organizations";
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
  const [isAdminHere, setIsAdminHere] = useState(false);
  const [volunteering, setVolunteering] = useState<"set" | "none">("none");
  const [pendingCoOrganizations, setPendingCoOrganizations] = useState<OrganizationRef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !id) return;
    let active = true;
    (async () => {
      const [ev, adminIds, pending] = await Promise.all([
        getEvent(id),
        getMyAdministeredMunicipalityIds(String(user.id)).catch(() => [] as string[]),
        getPendingCoOrganizers(id).catch(() => [] as OrganizationRef[]),
      ]);
      if (!active) return;
      setPendingCoOrganizations(pending);
      if (ev) {
        const uid = String(user.id);
        const isAdminHere = isSuperAdmin || (!!ev.municipality_id && adminIds.includes(ev.municipality_id));
        setIsAdminHere(isAdminHere);
        // The volunteering flag is the creator's alone — not a spolupořadatel's, not the obec's
        // (Events guardIsVolunteering). The creator sets it straight away, no obec approval.
        setVolunteering(isSuperAdmin || ev.organizer_id === uid ? "set" : "none");
        // With the obec on the event, only the obec edits it (Events lockedEventIds). Once it has
        // taken place, nobody does (Events canUpdateEvent).
        setCanEdit(
          ev.status !== "finished" &&
            (isAdminHere ||
              ((ev.organizer_id === uid || ev.co_organizer_ids.includes(uid)) && !ev.locked_for_viewer)),
        );
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
        coOrganizations: values.coOrganizationIds.map(Number),
        categories: values.categoryIds.map(Number),
        ...(values.imageId ? { image: Number(values.imageId) } : {}),
        imagePositionX: values.imagePosition.x,
        imagePositionY: values.imagePosition.y,
        isPaid: values.isPaid,
        priceCents: values.isPaid ? values.priceCents : null,
        ...(volunteering === "set" ? { isVolunteering: values.isVolunteering } : {}),
        isHidden: values.isHidden,
      });

      const sent = await sendFollowUpRequests(event.id, values.inviteOrganizationIds);
      toast.success(sent ? `Akce upravena, ${sent}.` : "Akce upravena. Přihlášení účastníci dostanou upozornění o změně.");
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
      <div className="animate-fade-in sm:mx-auto sm:max-w-3xl">
        <PageHeader title="Upravit akci" back />
        <EmptyState
          title={event ? "Tuto akci nemůžete upravit" : "Akce nebyla nalezena"}
          description={
            event?.status === "finished"
              ? "Akce už proběhla — upravovat ji nejde. Přihlášené a docházku spravovat můžete dál."
              : event?.locked_for_viewer
              ? "Tuhle akci pořádá nebo spolupořádá obec — upravit nebo zrušit ji může jen admin obce. Přihlášené a docházku spravovat můžete dál."
              : event
                ? "Upravovat ji může pořadatel nebo admin obce."
                : undefined
          }
        />
        {/* The obec locks the event's creator out of editing it, but not out of its volunteering. */}
        {event && volunteering === "set" && event.status !== "finished" && (
          <div className="px-4 pb-6">
            <VolunteeringCard eventId={event.id} isVolunteering={Boolean(event.is_volunteering)} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="animate-fade-in sm:mx-auto sm:max-w-3xl">
      <PageHeader title="Upravit akci" back />
      <EventForm
        userId={String(user.id)}
        initial={event}
        municipalityId={event.municipality_id ?? ""}
        municipalityCenter={event.lat != null && event.lng != null ? [event.lat, event.lng] : CZECHIA_CENTER}
        isObecAdmin={isAdminHere}
        volunteering={volunteering}
        runsAsObec={isMunicipalityOrganization(event.organization)}
        pendingCoOrganizations={pendingCoOrganizations}
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
