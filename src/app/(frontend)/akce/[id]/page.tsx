"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getEvent,
  getEventCategories,
  getOrganizerName,
  getEventRegistrationsWithNames,
  getRegistrationCounts,
  getMyAdministeredMunicipalityIds,
  createRegistration,
  cancelRegistration,
  CategoryRow,
  RegistrationCountRow,
} from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { useAuth } from "@/contexts/AuthContext";
import { Loading } from "@/components/Loading";
import { PageHeader } from "@/components/PageHeader";
import { CancelEventButton } from "@/components/CancelEventButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Calendar, MapPin, Users, Navigation, CheckCircle2, Clock, User as UserIcon, Settings, Tag, Accessibility, Pencil } from "lucide-react";
import { formatEventDate, formatEventTime } from "@/lib/date";
import { getCategoryIcon } from "@/lib/icons";
import { formatCzk } from "@/lib/money";

interface Reg { id: string; user_id: string; status: string; full_name: string }

const ACCESSIBILITY_LABELS: Record<string, string> = {
  wheelchair_access: "Bezbariérový přístup",
  induction_loop: "Indukční smyčka",
  seating: "Možnost sezení",
  accessible_wc: "WC pro invalidy",
};

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function EventDetailContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { user, isSuperAdmin } = useAuth();
  const [event, setEvent] = useState<Awaited<ReturnType<typeof getEvent>>>(null);
  const [eventCategories, setEventCategories] = useState<CategoryRow[]>([]);
  const [organizerName, setOrganizerName] = useState<string | null>(null);
  // Registrations the viewer may read: all of them for the organizer / obec admin, otherwise
  // just their own (Registrations.access.read) — used for "Kdo dále jde" and the viewer's status.
  const [regs, setRegs] = useState<Reg[]>([]);
  const [counts, setCounts] = useState<RegistrationCountRow>({ approved: 0, pending: 0 });
  const [administeredMunicipalityIds, setAdministeredMunicipalityIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const refreshRegistrations = async (eventId: string) => {
    const [regRows, countRows] = await Promise.all([
      user ? getEventRegistrationsWithNames(eventId) : Promise.resolve([]),
      getRegistrationCounts([eventId]),
    ]);
    setRegs(regRows);
    setCounts(countRows.get(eventId) ?? { approved: 0, pending: 0 });
  };

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);

    const ev = await getEvent(id);
    if (!ev) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setEvent(ev);

    const [cats, orgName, adminIds] = await Promise.all([
      ev.category_ids.length > 0 ? getEventCategories() : Promise.resolve([]),
      ev.organizer_id ? getOrganizerName(ev.organizer_id).catch(() => null) : Promise.resolve(null),
      user ? getMyAdministeredMunicipalityIds(String(user.id)).catch(() => []) : Promise.resolve([]),
      refreshRegistrations(ev.id),
    ]);
    setEventCategories(cats.filter((c) => ev.category_ids.includes(c.id)));
    setOrganizerName(orgName);
    setAdministeredMunicipalityIds(adminIds);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.id]);

  // Brief §8 live "Přihlásit se"/"Akce je plná" button — re-pull counts and the readable
  // registrations whenever the server says the approved count changed. Deliberately doesn't
  // touch `loading` — this is a quiet background refresh, not a page reload.
  useEffect(() => {
    if (!id) return;
    const source = new EventSource(`/api/events/${id}/capacity-stream`);
    source.onmessage = () => {
      refreshRegistrations(id).catch(() => {});
    };
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.id]);

  const myReg = regs.find((r) => r.user_id === String(user?.id));
  const approvedCount = counts.approved;
  const isFull = approvedCount >= (event?.capacity ?? 0);
  const isPaidEvent = !!event?.is_paid;
  const isEventOrganizer =
    !!user && !!event && (event.organizer_id === String(user.id) || event.co_organizer_ids.includes(String(user.id)));
  const isAdminOfEventMunicipality = !!event?.municipality_id && administeredMunicipalityIds.includes(event.municipality_id);
  const canManage = isEventOrganizer || isAdminOfEventMunicipality;
  // "Kdo dále jde" — names are only for the event's organizer and the obec's admin.
  const canSeeAttendees = canManage || isSuperAdmin;

  // A ref guard (checked synchronously, before the first await) closes the window a fast
  // double-click/double-tap leaves open with `submitting` state alone — React doesn't
  // repaint the disabled button until the next render, so two clicks in the same tick can
  // both get through and fire two requests (the DB has its own constraint as a backstop).
  const submittingRef = useRef(false);

  const handleJoinFree = async () => {
    if (!user) {
      // The auth page doesn't support a return-redirect yet — just get them logged in.
      router.push("/auth");
      return;
    }
    if (!event || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const reg = await createRegistration(event.id, String(user.id));
      toast.success(reg.status === "approved" ? "Jste přihlášeni na akci." : "Přihláška odeslána pořadateli ke schválení.");
      load();
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status === 400
          ? error.message
          : "Nepodařilo se přihlásit. Zkuste to prosím znovu.",
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!myReg || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await cancelRegistration(myReg.id);
      toast.success("Přihláška zrušena.");
      load();
    } catch {
      toast.error("Nepodařilo se zrušit přihlášku.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (loading) return <Loading />;
  if (notFound || !event) return (
    <div className="animate-fade-in">
      <PageHeader title="Detail akce" back />
      <div className="p-6 text-center text-muted-foreground">Akce nebyla nalezena.</div>
    </div>
  );

  const Icon = getCategoryIcon(eventCategories[0]?.icon);
  const navUrl = event.lat && event.lng
    ? `https://www.google.com/maps/dir/?api=1&destination=${event.lat},${event.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location_text)}`;
  const mapEmbed = event.lat && event.lng
    ? `https://www.google.com/maps?q=${event.lat},${event.lng}&z=15&output=embed`
    : `https://www.google.com/maps?q=${encodeURIComponent(event.location_text)}&output=embed`;
  const approvedAttendees = regs.filter((r) => r.status === "approved");

  return (
    <article className="animate-fade-in pb-6">
      <PageHeader title="Detail akce" back right={
        canManage ? (
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm" className="h-10">
              <Link href={`/upravit/${event.id}`}><Pencil className="h-4 w-4" />Upravit</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-10">
              <Link href={`/spravovat/${event.id}`}><Settings className="h-4 w-4" />Spravovat</Link>
            </Button>
          </div>
        ) : null
      } />

      {event.image_url && (
        // Full-bleed on a phone; from sm up a contained, centred, rounded photo with a side gutter —
        // at full desktop width the 16:10 frame was nearly a screen tall. The 16:10 ratio itself
        // stays, so the organizer's chosen framing (imagePositionX/Y) matches the event cards.
        <div className="aspect-[16/10] overflow-hidden bg-muted sm:mx-auto sm:mt-4 sm:w-[calc(100%_-_2rem)] sm:max-w-3xl sm:rounded-2xl">
          <img
            src={event.image_url}
            alt={event.title}
            className="w-full h-full object-cover"
            style={{ objectPosition: `${event.image_position.x}% ${event.image_position.y}%` }}
            width={512}
            height={320}
          />
        </div>
      )}

      <div className="px-4 py-5 space-y-5">
        <div className="flex items-center gap-2 flex-wrap">
          {eventCategories.map((category) => (
            <Badge
              key={category.id}
              variant="outline"
              className="text-xs font-semibold gap-1 border-0"
              style={{ backgroundColor: `hsl(${category.color} / 0.15)`, color: `hsl(${category.color})` }}
            >
              <Icon className="h-3.5 w-3.5" />
              {category.name}
            </Badge>
          ))}
          {isPaidEvent ? (
            <Badge className="bg-accent text-accent-foreground gap-1">
              <Tag className="h-3 w-3" /> {event.price_cents ? formatCzk(event.price_cents) : "Placená akce"}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-success/40 text-success">Zdarma</Badge>
          )}
        </div>
        {isPaidEvent && (
          <p className="text-sm text-muted-foreground -mt-3">
            Platbu si domlouváte přímo s pořadatelem — aplikace platby nezpracovává.
          </p>
        )}
        <h1 className="text-2xl font-extrabold leading-tight">{event.title}</h1>

        <div className="space-y-3 bg-secondary rounded-2xl p-4">
          <div className="flex items-start gap-3">
            <Calendar className="h-5 w-5 mt-0.5 text-primary shrink-0" />
            <div>
              <p className="font-semibold capitalize">{formatEventDate(event.date_time)}</p>
              <p className="text-sm text-muted-foreground">
                {event.end_date_time
                  ? `${formatEventTime(event.date_time)} – ${formatEventDate(event.end_date_time)} ${formatEventTime(event.end_date_time)}`
                  : `začátek v ${formatEventTime(event.date_time)}`}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MapPin className="h-5 w-5 mt-0.5 text-primary shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">{event.location_text}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Users className="h-5 w-5 mt-0.5 text-primary shrink-0" />
            <p className="font-semibold">
              {approvedCount} / {event.capacity} přihlášených
              {counts.pending > 0 && (
                <span className="text-muted-foreground font-normal"> · {counts.pending} čeká</span>
              )}
            </p>
          </div>
          {(event.organization_name || organizerName) && (
            <div className="flex items-start gap-3">
              <UserIcon className="h-5 w-5 mt-0.5 text-primary shrink-0" />
              <p className="font-semibold">
                Pořadatel: {event.organization_name ?? organizerName}
                {event.organization_name && organizerName && (
                  <span className="text-muted-foreground font-normal"> · {organizerName}</span>
                )}
              </p>
            </div>
          )}
          {event.accessibility_tags.length > 0 && (
            <div className="flex items-start gap-3">
              <Accessibility className="h-5 w-5 mt-0.5 text-primary shrink-0" />
              <p className="font-semibold">
                {event.accessibility_tags.map((t) => ACCESSIBILITY_LABELS[t] ?? t).join(", ")}
              </p>
            </div>
          )}
        </div>

        <div>
          <h2 className="text-lg font-bold mb-2">Popis akce</h2>
          <p className="text-base leading-relaxed whitespace-pre-line text-foreground/90">{event.description}</p>
        </div>

        <div>
          <h2 className="text-lg font-bold mb-2">Místo konání</h2>
          <div className="rounded-2xl overflow-hidden border border-border">
            <iframe
              title="Mapa"
              src={mapEmbed}
              className="w-full h-72 sm:h-[28rem] border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <Button asChild variant="outline" className="w-full h-12 mt-3 text-base">
            <a href={navUrl} target="_blank" rel="noreferrer">
              <Navigation className="h-5 w-5" />
              Navigovat
            </a>
          </Button>
        </div>

        {canSeeAttendees && (
          <div>
            <h2 className="text-lg font-bold mb-2">Kdo dále jde</h2>
            {approvedAttendees.length === 0 ? (
              <Card className="bg-muted/50 border-dashed">
                <CardContent className="py-4 text-center text-sm text-muted-foreground">
                  Zatím nikdo není potvrzen.
                </CardContent>
              </Card>
            ) : (
              <div className="flex flex-wrap gap-2">
                {approvedAttendees.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 bg-secondary rounded-full pl-1 pr-3 py-1">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                        {initials(r.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium">{r.full_name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {(canManage || isSuperAdmin) && (
          <div className="rounded-2xl border border-destructive/30 p-4 space-y-3">
            <div>
              <h2 className="text-lg font-bold">Zrušení akce</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Přihlášení účastníci dostanou upozornění e-mailem, SMS a v aplikaci.
              </p>
            </div>
            <CancelEventButton eventId={event.id} title={event.title} dateTime={event.date_time} />
          </div>
        )}
      </div>

      <div className="sticky bottom-0 z-20 bg-background/95 backdrop-blur border-t border-border px-4 py-3 -mb-2">
        {isEventOrganizer ? (
          // The organizer takes part automatically and doesn't use up a participant's spot.
          <div className="flex items-center justify-center gap-2 py-3 text-sm font-semibold text-primary">
            <CheckCircle2 className="h-5 w-5" /> Tuto akci pořádáte — počítá se s vámi automaticky
          </div>
        ) : myReg ? (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 py-1 text-sm font-semibold">
              {myReg.status === "approved" ? (
                <><CheckCircle2 className="h-5 w-5 text-success" /> <span className="text-success">Jste přihlášen/a</span></>
              ) : (
                <><Clock className="h-5 w-5 text-warning" /> <span className="text-warning">Čeká na schválení pořadatelem</span></>
              )}
            </div>
            <Button onClick={handleCancel} disabled={submitting} variant="outline" className="w-full h-12 text-base">
              Zrušit přihlášku
            </Button>
          </div>
        ) : isFull ? (
          <Button disabled className="w-full h-14 text-base font-semibold">Akce je plná</Button>
        ) : (
          <Button onClick={handleJoinFree} disabled={submitting} className="w-full h-14 text-base font-semibold">
            Přihlásit se
          </Button>
        )}
      </div>
    </article>
  );
}

export default function EventDetailPage() {
  return <EventDetailContent />;
}
