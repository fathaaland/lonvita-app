"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CalendarCheck, CalendarClock, HandHeart, Mail, MapPin, Pencil, Phone, Send } from "lucide-react";
import { getVolunteerDetail, VolunteerDetail } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { UserAvatar } from "@/components/UserAvatar";
import { RatingStars } from "@/components/RatingStars";
import { focusLabel } from "@/components/VolunteerCard";
import { InviteVolunteerDialog } from "@/components/InviteVolunteerDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" });

const ratingsLabel = (n: number) => (n === 1 ? "1 hodnocení" : `${n} hodnocení`);

/** A volunteer's card — what an organizer looks at before inviting them, and what the volunteer
 * sees of themselves under "Dobrovolník": where they help, their ratings from organizers and the
 * events they've helped on. Gone while they're out of the pool (the data waits for them). */
function VolunteerContent() {
  const { id } = useParams<{ id: string }>();
  const { isOrganizer, isAdmin } = useAuth();
  const [detail, setDetail] = useState<VolunteerDetail | null | undefined>(undefined);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    let active = true;
    setDetail(undefined);
    getVolunteerDetail(id)
      .catch(() => null)
      .then((d) => active && setDetail(d));
    return () => {
      active = false;
    };
  }, [id]);

  if (detail === undefined) return <><PageHeader title="Dobrovolník" back /><Loading /></>;

  if (detail === null) {
    return (
      <div className="animate-fade-in sm:mx-auto sm:max-w-3xl">
        <PageHeader title="Dobrovolník" back />
        <EmptyState
          icon={HandHeart}
          title="Karta dobrovolníka tu není"
          description="Tenhle člověk teď v poolu dobrovolníků není. Kartu uvidíte znovu, až se do poolu vrátí."
          action={
            <Button asChild variant="outline">
              <Link href="/profil">Pool dobrovolníků v profilu</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const { volunteer: v, is_self: isSelf, ratings, events } = detail;
  const upcoming = events.filter((e) => e.upcoming).reverse();
  const past = events.filter((e) => !e.upcoming);
  const canInvite = !isSelf && (isOrganizer || isAdmin);

  return (
    <div className="animate-fade-in sm:mx-auto sm:max-w-3xl">
      <PageHeader title={isSelf ? "Moje karta dobrovolníka" : "Dobrovolník"} back />
      <div className="px-4 py-5 space-y-6">
        <section className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:text-left">
          <UserAvatar
            name={v.full_name}
            src={v.avatar_url}
            className="h-24 w-24 shrink-0 ring-4 ring-card shadow-card"
            fallbackClassName="bg-primary-soft text-brand-purple-dark text-3xl font-extrabold"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-2xl sm:text-3xl font-extrabold leading-tight break-words">{v.full_name}</h2>
            <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-muted-foreground sm:justify-start">
              {v.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-4 w-4" aria-hidden /> Pomáhá v obci {v.location.name}
                </span>
              )}
              {v.volunteer_since && <span>V poolu od {formatDate(v.volunteer_since)}</span>}
            </p>
          </div>
          {/* The one thing an organizer weighs first — the average, large and lit. */}
          <div className="flex shrink-0 flex-col items-center rounded-2xl bg-card px-5 py-3 shadow-card">
            {v.rating ? (
              <>
                <span className="text-4xl font-extrabold tabular-nums leading-none text-amber-500 drop-shadow-[0_0_10px_rgba(251,191,36,0.45)]">
                  {v.rating.average.toLocaleString("cs-CZ", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </span>
                <RatingStars value={Math.round(v.rating.average)} size="sm" label="Průměrné hodnocení" />
                <span className="mt-1 text-xs text-muted-foreground">{ratingsLabel(v.rating.count)}</span>
              </>
            ) : (
              <span className="py-2 text-sm text-muted-foreground">Zatím bez hodnocení</span>
            )}
          </div>
        </section>

        <div className="flex flex-col gap-2 sm:flex-row">
          {canInvite && (
            <Button className="h-12 sm:flex-1" onClick={() => setInviting(true)}>
              <Send className="h-4 w-4" /> Pozvat na akci
            </Button>
          )}
          {isSelf && (
            <Button asChild variant="outline" className="h-12 sm:flex-1">
              <Link href="/profil">
                <Pencil className="h-4 w-4" /> Upravit v profilu
              </Link>
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-4 space-y-4">
            {(v.volunteer_focus ?? []).length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">S čím pomůže</p>
                <div className="flex flex-wrap gap-1.5">
                  {(v.volunteer_focus ?? []).map((f) => (
                    <span key={f} className="rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold text-brand-purple-dark">
                      {focusLabel(f)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {v.volunteer_note && <p className="text-base">„{v.volunteer_note}“</p>}
            {(v.phone || v.email) && (
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                {v.phone && (
                  <a href={`tel:${v.phone}`} className="inline-flex items-center gap-1.5 font-semibold text-primary">
                    <Phone className="h-4 w-4" aria-hidden /> {v.phone}
                  </a>
                )}
                {v.email && (
                  <a href={`mailto:${v.email}`} className="inline-flex items-center gap-1.5 font-semibold text-primary break-all">
                    <Mail className="h-4 w-4 shrink-0" aria-hidden /> {v.email}
                  </a>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <section className="space-y-2">
          <h3 className="text-lg font-bold">Hodnocení od pořadatelů</h3>
          {ratings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isSelf
                ? "Po akci, na které pomůžete, vás pořadatel může ohodnotit. Hodnocení se ukáže tady."
                : "Zatím nemá žádné hodnocení."}
            </p>
          ) : (
            <ul className="space-y-2">
              {ratings.map((r) => (
                <li key={r.id}>
                  <Card>
                    <CardContent className="p-4 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <RatingStars value={r.rating} size="sm" />
                        <span className="text-xs text-muted-foreground">{formatDate(r.created_at)}</span>
                      </div>
                      {r.comment && <p className="text-sm">„{r.comment}“</p>}
                      <p className="text-xs text-muted-foreground">
                        {r.rated_by_name} ·{" "}
                        <Link href={`/akce/${r.event_id}`} className="hover:underline">
                          {r.event_title}
                        </Link>
                      </p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        {(upcoming.length > 0 || past.length > 0) && (
          <section className="space-y-2">
            <h3 className="text-lg font-bold">Kde pomáhá</h3>
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
              {[...upcoming, ...past].map((e) => (
                <li key={e.id}>
                  <Link href={`/akce/${e.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted">
                    {e.upcoming ? (
                      <CalendarClock className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                    ) : (
                      <CalendarCheck className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{e.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(e.date_time)}
                        {e.upcoming ? " · chystá se" : e.attended ? " · pomohl/a" : ""}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {canInvite && (
        <InviteVolunteerDialog
          volunteer={inviting ? { user_id: v.user_id, full_name: v.full_name } : null}
          onOpenChange={(open) => !open && setInviting(false)}
        />
      )}
    </div>
  );
}

export default function VolunteerPage() {
  return (
    <RequireAuth>
      <VolunteerContent />
    </RequireAuth>
  );
}
