"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createEvent,
  requestVolunteerFlag,
  getMunicipality,
  getMyAdministeredMunicipalityIds,
  getMyOrganizerMunicipalityIds,
} from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth, RequireRole } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { EventForm, EventFormValues } from "@/components/EventForm";
import { toast } from "sonner";

const CZECHIA_CENTER: [number, number] = [49.8175, 15.473];

function CreateEventContent() {
  const router = useRouter();
  const { user, profile, isAdmin } = useAuth();
  // The obec the event is filed under: one where this user actually holds the admin/organizer
  // role (their home obec when they hold it there). Their home municipality alone isn't enough —
  // a "bez obce" admin has none, and a superadmin can grant a role for a town they don't live in.
  const [municipalityId, setMunicipalityId] = useState<string | null | undefined>(undefined);
  const [center, setCenter] = useState<[number, number]>(CZECHIA_CENTER);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const uid = String(user.id);
      const [adminIds, organizerIds] = await Promise.all([
        getMyAdministeredMunicipalityIds(uid),
        getMyOrganizerMunicipalityIds(uid),
      ]);
      const candidates = [...adminIds, ...organizerIds];
      const home = profile?.municipality_id ?? null;
      const chosen = home && candidates.includes(home) ? home : (candidates[0] ?? home);
      if (!active) return;
      setMunicipalityId(chosen);
      if (chosen) {
        const muni = await getMunicipality(chosen);
        if (active && muni) setCenter([muni.lat, muni.lng]);
      }
    })().catch(() => {
      if (active) setMunicipalityId(profile?.municipality_id ?? null);
    });
    return () => {
      active = false;
    };
  }, [user?.id, profile?.municipality_id]);

  const handleSubmit = async (values: EventFormValues) => {
    if (!user || !municipalityId) return;
    try {
      const created = await createEvent({
        title: values.title,
        description: values.description,
        dateTimeIso: values.dateTimeIso,
        endDateTimeIso: values.endDateTimeIso ?? undefined,
        recurrenceRule: values.recurrenceRule ?? undefined,
        locationText: values.location.label,
        lat: values.location.lat,
        lng: values.location.lng,
        accessibilityTags: values.accessibilityTags,
        capacity: values.capacity,
        registrationApprovalMode: values.registrationApprovalMode,
        organizerUserId: String(user.id),
        municipalityId,
        organizationId: values.organizationId ?? undefined,
        coOrganizerIds: values.coOrganizerIds,
        categoryIds: values.categoryIds,
        imageId: values.imageId ?? undefined,
        imagePositionX: values.imagePosition.x,
        imagePositionY: values.imagePosition.y,
        // Only an admin can flip isVolunteering directly (brief §3) — a plain organizer's
        // checkbox instead fires a VolunteerFlagRequest right after creation, below.
        isVolunteering: isAdmin ? values.isVolunteering : false,
        isPaid: values.isPaid,
        priceCents: values.priceCents ?? undefined,
      });

      if (values.isVolunteering && !isAdmin) {
        try {
          await requestVolunteerFlag(created.id, String(user.id));
          toast.success("Akce vytvořena, žádost o příznak Dobrovolnictví odeslána.");
        } catch {
          toast.success("Akce vytvořena.");
          toast.error("Žádost o příznak Dobrovolnictví se nepodařilo odeslat.");
        }
      } else {
        toast.success("Akce vytvořena!");
      }
      router.push(`/akce/${created.id}`);
    } catch (error) {
      // e.g. the location-radius or past-date checks in Events.ts — their messages are user-facing.
      toast.error(
        error instanceof PayloadApiError && error.status === 400
          ? error.message
          : "Nepodařilo se vytvořit akci. Zkontrolujte oprávnění.",
      );
    }
  };

  if (!user || municipalityId === undefined) {
    return <><PageHeader title="Vytvořit akci" back /><Loading /></>;
  }

  if (!municipalityId) {
    return (
      <div className="animate-fade-in sm:mx-auto sm:max-w-3xl">
        <PageHeader title="Vytvořit akci" back />
        <EmptyState title="Není kde akci založit" description="Nemáte obec, pro kterou byste mohli zakládat akce." />
      </div>
    );
  }

  return (
    <div className="animate-fade-in sm:mx-auto sm:max-w-3xl">
      <PageHeader title="Vytvořit akci" back />
      <EventForm
        userId={String(user.id)}
        municipalityId={municipalityId}
        municipalityCenter={center}
        canSetVolunteering={isAdmin}
        submitLabel="Vytvořit akci"
        onSubmit={handleSubmit}
      />
    </div>
  );
}

export default function CreateEventPage() {
  return (
    <RequireAuth>
      <RequireRole role="organizer">
        <CreateEventContent />
      </RequireRole>
    </RequireAuth>
  );
}
