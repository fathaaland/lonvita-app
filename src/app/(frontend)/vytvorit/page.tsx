"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createEvent, getMunicipality } from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth, RequireRole } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { EventForm, EventFormValues } from "@/components/EventForm";
import { sendFollowUpRequests } from "@/lib/eventFollowUpRequests";
import { toast } from "sonner";

const CZECHIA_CENTER: [number, number] = [49.8175, 15.473];

function CreateEventContent() {
  const router = useRouter();
  const { user, profile, administeredMunicipalityIds, creatableMunicipalityIds } = useAuth();
  // The obec the event is filed under: one where this user may found events — they administer it,
  // or organize there and it takes events from its organizers (their home obec when it's one of
  // those). Their home municipality alone isn't enough — a "bez obce" admin has none, and a
  // superadmin can grant a role for a town they don't live in.
  const [municipalityId, setMunicipalityId] = useState<string | null | undefined>(undefined);
  // Its admin creates the event as the obec itself.
  const [adminHere, setAdminHere] = useState(false);
  const [center, setCenter] = useState<[number, number]>(CZECHIA_CENTER);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const home = profile?.municipality_id ?? null;
      const chosen = home && creatableMunicipalityIds.includes(home) ? home : (creatableMunicipalityIds[0] ?? null);
      if (!active) return;
      setMunicipalityId(chosen);
      setAdminHere(Boolean(chosen && administeredMunicipalityIds.includes(chosen)));
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
  }, [user?.id, profile?.municipality_id, creatableMunicipalityIds, administeredMunicipalityIds]);

  const handleSubmit = async (values: EventFormValues) => {
    if (!user || !municipalityId) return;
    try {
      const created = await createEvent({
        title: values.title,
        description: values.description,
        dateTimeIso: values.dateTimeIso,
        endDateTimeIso: values.endDateTimeIso ?? undefined,
        locationText: values.location.label,
        lat: values.location.lat,
        lng: values.location.lng,
        accessibilityTags: values.accessibilityTags,
        capacity: values.capacity,
        registrationApprovalMode: values.registrationApprovalMode,
        organizerUserId: String(user.id),
        municipalityId,
        categoryIds: values.categoryIds,
        imageId: values.imageId ?? undefined,
        imagePositionX: values.imagePosition.x,
        imagePositionY: values.imagePosition.y,
        // The flag is the creator's to set — no obec approval.
        isVolunteering: values.isVolunteering,
        isPaid: values.isPaid,
        priceCents: values.priceCents ?? undefined,
        isDraft: values.isDraft,
      });

      if (values.isDraft) {
        // Nobody may be invited to a draft — the picked spolupořadatelé wait for publishing.
        toast.success(
          values.inviteOrganizationIds.length > 0
            ? "Koncept uložen. Spolupořadatele pozvete po zveřejnění akce."
            : "Koncept uložen — vidíte ho jen vy.",
        );
        router.push(`/akce/${created.id}`);
        return;
      }
      const sent = await sendFollowUpRequests(created.id, values.inviteOrganizationIds);
      toast.success(sent ? `Akce vytvořena, ${sent}.` : "Akce vytvořena!");
      router.push(`/akce/${created.id}?sdilet=1`);
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
        <EmptyState
          title="Není kde akci založit"
          description="Nemáte obec, pro kterou byste mohli zakládat akce — tam, kde jste organizátorem, teď akce zakládá jen obec sama."
        />
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
        isObecAdmin={adminHere}
        volunteering="set"
        runsAsObec={adminHere}
        submitLabel="Zveřejnit akci"
        draftLabel="Uložit jako koncept"
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
