"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getEvent,
  getEventCategories,
  getOrganizerName,
  getEventRegistrationsWithNames,
  createRegistration,
  cancelRegistration,
  CategoryRow,
} from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { Loading } from "@/components/Loading";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Calendar, MapPin, Users, Navigation, CheckCircle2, Clock, User as UserIcon, Settings, Tag } from "lucide-react";
import { formatEventDate, formatEventTime } from "@/lib/date";
import { getCategoryIcon } from "@/lib/icons";
import { formatCzk } from "@/lib/stripe";

interface Reg { id: string; user_id: string; status: string; full_name: string; payment_status: string }

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function EventDetailContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user } = useAuth();
  const [event, setEvent] = useState<Awaited<ReturnType<typeof getEvent>>>(null);
  const [category, setCategory] = useState<CategoryRow | null>(null);
  const [organizerName, setOrganizerName] = useState<string | null>(null);
  const [regs, setRegs] = useState<Reg[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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

    const [cats, orgName, regRows] = await Promise.all([
      ev.category_id ? getEventCategories() : Promise.resolve([]),
      ev.organizer_id ? getOrganizerName(ev.organizer_id) : Promise.resolve(null),
      getEventRegistrationsWithNames(ev.id),
    ]);
    setCategory(cats.find((c) => c.id === ev.category_id) ?? null);
    setOrganizerName(orgName);
    setRegs(regRows);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const myReg = regs.find((r) => r.user_id === String(user?.id));
  const approvedCount = regs.filter((r) => r.status === "approved").length;
  const totalCount = regs.length;
  const isFull = approvedCount >= (event?.capacity ?? 0);
  const isPaidEvent = !!event?.is_paid && !!event?.price_cents;

  const handleJoinFree = async () => {
    if (!event || !user) return;
    setSubmitting(true);
    try {
      await createRegistration(event.id, String(user.id));
      toast.success("Přihláška odeslána pořadateli ke schválení.");
      load();
    } catch {
      toast.error("Nepodařilo se přihlásit. Zkuste to prosím znovu.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!myReg) return;
    setSubmitting(true);
    try {
      await cancelRegistration(myReg.id);
      toast.success("Přihláška zrušena.");
      load();
    } catch {
      toast.error("Nepodařilo se zrušit přihlášku.");
    } finally {
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

  const Icon = getCategoryIcon(category?.icon);
  const navUrl = event.lat && event.lng
    ? `https://www.google.com/maps/dir/?api=1&destination=${event.lat},${event.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location_text)}`;
  const mapEmbed = event.lat && event.lng
    ? `https://www.google.com/maps?q=${event.lat},${event.lng}&z=15&output=embed`
    : `https://www.google.com/maps?q=${encodeURIComponent(event.location_text)}&output=embed`;

  return (
    <article className="animate-fade-in pb-6">
      <PageHeader title="Detail akce" back right={
        event.organizer_id === String(user?.id) ? (
          <Button asChild variant="outline" size="sm" className="h-10">
            <Link href={`/spravovat/${event.id}`}><Settings className="h-4 w-4" />Spravovat</Link>
          </Button>
        ) : null
      } />

      {event.image_url && (
        <div className="aspect-[16/10] overflow-hidden bg-muted">
          <img src={event.image_url} alt={event.title} className="w-full h-full object-cover" width={512} height={320} />
        </div>
      )}

      <div className="px-4 py-5 space-y-5">
        <div className="flex items-center gap-2 flex-wrap">
          {category && (
            <Badge
              variant="outline"
              className="text-xs font-semibold gap-1 border-0"
              style={{ backgroundColor: `hsl(${category.color} / 0.15)`, color: `hsl(${category.color})` }}
            >
              <Icon className="h-3.5 w-3.5" />
              {category.name}
            </Badge>
          )}
          {isPaidEvent ? (
            <Badge className="bg-accent text-accent-foreground gap-1">
              <Tag className="h-3 w-3" /> {formatCzk(event.price_cents)}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-success/40 text-success">Zdarma</Badge>
          )}
        </div>
        <h1 className="text-2xl font-extrabold leading-tight">{event.title}</h1>

        <div className="space-y-3 bg-secondary rounded-2xl p-4">
          <div className="flex items-start gap-3">
            <Calendar className="h-5 w-5 mt-0.5 text-primary shrink-0" />
            <div>
              <p className="font-semibold capitalize">{formatEventDate(event.date_time)}</p>
              <p className="text-sm text-muted-foreground">začátek v {formatEventTime(event.date_time)}</p>
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
              {totalCount > approvedCount && (
                <span className="text-muted-foreground font-normal"> · {totalCount - approvedCount} čeká</span>
              )}
            </p>
          </div>
          {organizerName && (
            <div className="flex items-start gap-3">
              <UserIcon className="h-5 w-5 mt-0.5 text-primary shrink-0" />
              <p className="font-semibold">Pořadatel: {organizerName}</p>
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
              className="w-full h-56 border-0"
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

        <div>
          <h2 className="text-lg font-bold mb-2">Kdo dále jde</h2>
          {regs.filter((r) => r.status === "approved").length === 0 ? (
            <Card className="bg-muted/50 border-dashed">
              <CardContent className="py-4 text-center text-sm text-muted-foreground">
                Zatím nikdo není potvrzen — buďte první!
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-wrap gap-2">
              {regs.filter((r) => r.status === "approved").map((r) => (
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
      </div>

      <div className="sticky bottom-0 z-20 bg-background/95 backdrop-blur border-t border-border px-4 py-3 -mb-2">
        {myReg ? (
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
        ) : isPaidEvent ? (
          <Button disabled className="w-full h-14 text-base font-semibold">Placené akce zatím nejsou podporovány</Button>
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
  return (
    <RequireAuth>
      <EventDetailContent />
    </RequireAuth>
  );
}
