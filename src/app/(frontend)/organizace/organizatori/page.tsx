"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CalendarOff, Contact, Mail, Pencil, Store } from "lucide-react";
import {
  getMunicipalityOrganizers,
  listMunicipalities,
  type OrganizerProfileRow,
} from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth, RequireRole } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { OrganizationMark } from "@/components/EventCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ORGANIZATION_TYPES, organizationTypeLabel } from "@/lib/organizations";
import { formatPercent } from "@/lib/organization-stats";
import { cn } from "@/lib/utils";

const ALL = "all";

const organizersLabel = (n: number) =>
  n === 1 ? "1 pořadatel" : n >= 2 && n <= 4 ? `${n} pořadatelé` : `${n} pořadatelů`;

const eventsLabel = (n: number) => (n === 1 ? "akce" : n >= 2 && n <= 4 ? "akce" : "akcí");

const sinceLabel = (iso: string) =>
  `na Lonvitě od ${new Date(iso).toLocaleDateString("cs-CZ", { month: "long", year: "numeric" })}`;

/** One of the three numbers on a profile — the same ones its Organizace page leads with. */
function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <dd className="text-2xl font-extrabold tabular-nums leading-none">{value}</dd>
      <dt className="mt-1 text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}

/** The organization's next event as a tear-off calendar leaf — the same one its event card carries. */
function NextEvent({ event }: { event: OrganizerProfileRow["next_event"] }) {
  if (!event) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarOff className="h-4 w-4 shrink-0" aria-hidden /> Zatím nemá naplánovanou akci
      </p>
    );
  }
  const date = new Date(event.date_time);
  return (
    <Link
      href={`/akce/${event.id}`}
      className="group flex items-center gap-3 rounded-xl -m-1 p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="w-11 shrink-0 overflow-hidden rounded-lg bg-card text-center shadow-sm ring-1 ring-border" aria-hidden>
        <span className="block bg-primary py-px text-[10px] font-semibold text-primary-foreground">
          {date.toLocaleDateString("cs-CZ", { month: "short" }).replace(".", "")}
        </span>
        <span className="block py-0.5 text-lg font-extrabold leading-tight tabular-nums">{date.getDate()}</span>
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">Nejbližší akce</span>
        <span className="block truncate font-semibold group-hover:underline">{event.title}</span>
      </span>
    </Link>
  );
}

/** The three numbers on a profile — the same ones its Organizace page leads with. */
function Figures({ stats }: { stats: OrganizerProfileRow["stats"] }) {
  return (
    <dl className="grid grid-cols-3 divide-x divide-border rounded-xl bg-brand-sand-pale px-4 py-3">
      <Figure
        value={String(stats.eventCount)}
        label={
          stats.coOrganizedCount > 0
            ? `${eventsLabel(stats.eventCount)}, ${stats.coOrganizedCount} spolu s jinými`
            : eventsLabel(stats.eventCount)
        }
      />
      <Figure
        value={String(stats.people)}
        label={stats.returning > 0 ? `lidí, ${stats.returning} opakovaně` : "lidí na akcích"}
      />
      <Figure value={stats.fillRate === null ? "—" : formatPercent(stats.fillRate)} label="naplněnost" />
    </dl>
  );
}

function Byline({ organizer }: { organizer: OrganizerProfileRow }) {
  return (
    <>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {organizationTypeLabel(organizer.type)}
        {organizer.owner_name && organizer.owner_name !== organizer.name && <>, vede {organizer.owner_name}</>}
      </p>
      <p className="text-xs text-muted-foreground">{sinceLabel(organizer.since)}</p>
    </>
  );
}

function EditOwnLink({ organizer }: { organizer: OrganizerProfileRow }) {
  return (
    <Link
      href={`/organizace?organizace=${organizer.id}`}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-brand-purple-pale px-3 text-sm font-semibold text-brand-purple-dark hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Pencil className="h-3.5 w-3.5" aria-hidden /> Upravit profil
    </Link>
  );
}

/** One pořadatel in the directory — a preview; the whole profile with the contact opens in a dialog. */
function OrganizerProfile({ organizer, onOpen }: { organizer: OrganizerProfileRow; onOpen: () => void }) {
  return (
    <Card className={cn("h-full", organizer.is_own && "border-primary/50")}>
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <header className="flex items-start gap-3">
          <OrganizationMark organization={organizer} className="h-14 w-14 text-base ring-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-extrabold leading-tight break-words">
              <button
                type="button"
                onClick={onOpen}
                className="rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {organizer.name}
              </button>
            </h2>
            <Byline organizer={organizer} />
          </div>
          {organizer.is_own && <EditOwnLink organizer={organizer} />}
        </header>

        {organizer.description ? (
          <p className="line-clamp-3 whitespace-pre-line text-[15px] leading-relaxed text-foreground/85">
            {organizer.description}
          </p>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            {organizer.is_own ? "Zatím jste o sobě nic nenapsali — popis přidáte v Upravit profil." : "Popis zatím nepřidali."}
          </p>
        )}

        <div className="mt-auto space-y-4">
          <Figures stats={organizer.stats} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <NextEvent event={organizer.next_event} />
            <Button variant="outline" onClick={onOpen} className="h-10 shrink-0">
              <Contact className="h-4 w-4" aria-hidden /> Detail a kontakt
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** The whole profile — the full description and the contact its owner allows the obec's organizers. */
function OrganizerDetailDialog({
  organizer,
  onOpenChange,
}: {
  organizer: OrganizerProfileRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const contact = organizer?.contact;
  return (
    <Dialog open={organizer !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {organizer && (
          <>
            <DialogHeader className="text-left">
              <div className="flex items-start gap-3 pr-6">
                <OrganizationMark organization={organizer} className="h-16 w-16 text-lg ring-0" />
                <div className="min-w-0">
                  <DialogTitle className="text-2xl font-extrabold leading-tight break-words">{organizer.name}</DialogTitle>
                  <DialogDescription asChild>
                    <div>
                      <Byline organizer={organizer} />
                    </div>
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {contact?.email && (
              <section aria-label="Kontakt" className="rounded-xl border border-border p-4">
                <a
                  href={`mailto:${contact.email}`}
                  className="flex items-center gap-3 rounded-lg p-1 -m-1 text-lg font-semibold text-primary break-all hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Mail className="h-5 w-5 shrink-0" aria-hidden /> {contact.email}
                </a>
              </section>
            )}

            {organizer.description && (
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-foreground/85">{organizer.description}</p>
            )}

            <Figures stats={organizer.stats} />
            <NextEvent event={organizer.next_event} />

            {organizer.is_own && (
              <div className="flex justify-end">
                <EditOwnLink organizer={organizer} />
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OrganizersContent() {
  const { user, administeredMunicipalityIds, organizerMunicipalityIds, profile } = useAuth();
  const myMunicipalityIds = useMemo(
    () => [...new Set([...administeredMunicipalityIds, ...organizerMunicipalityIds])],
    [administeredMunicipalityIds, organizerMunicipalityIds],
  );
  const myKey = myMunicipalityIds.join(",");
  // "?obec=<id>" — opened from the Organizace page of an organization in that obec.
  const requestedObec = useSearchParams().get("obec");

  const [municipalities, setMunicipalities] = useState<{ id: string; name: string }[]>([]);
  const [municipalityId, setMunicipalityId] = useState<string | null>(null);
  const [organizers, setOrganizers] = useState<OrganizerProfileRow[] | null>(null);
  const [error, setError] = useState(false);
  const [type, setType] = useState<string>(ALL);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (myMunicipalityIds.length === 0) return;
    listMunicipalities()
      .then((all) => {
        const mine = all
          .filter((m) => myMunicipalityIds.includes(m.id))
          .map((m) => ({ id: m.id, name: m.name }))
          .sort((a, b) => a.name.localeCompare(b.name, "cs"));
        setMunicipalities(mine);
        // Their home obec first, when they organize there.
        const home = profile?.municipality_id;
        const preferred = [requestedObec, home].find((id) => id && myMunicipalityIds.includes(id));
        setMunicipalityId((current) => current ?? preferred ?? mine[0]?.id ?? null);
      })
      .catch(() => setError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myKey]);

  useEffect(() => {
    if (!municipalityId) return;
    let active = true;
    setOrganizers(null);
    setError(false);
    setType(ALL);
    getMunicipalityOrganizers(municipalityId)
      .then((rows) => {
        if (!active) return;
        // Their own profile first — the one they come here to check.
        setOrganizers([...rows].sort((a, b) => Number(b.is_own) - Number(a.is_own)));
      })
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [municipalityId]);

  const municipalityName = municipalities.find((m) => m.id === municipalityId)?.name;
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of organizers ?? []) counts.set(o.type, (counts.get(o.type) ?? 0) + 1);
    return counts;
  }, [organizers]);
  const shown = (organizers ?? []).filter((o) => type === ALL || o.type === type);
  const typeOptions = ORGANIZATION_TYPES.filter((t) => typeCounts.has(t.value));

  return (
    <div className="animate-fade-in sm:mx-auto sm:max-w-5xl">
      <PageHeader
        back
        title="Organizátoři v mém městě"
        subtitle={
          municipalityName && organizers
            ? `${organizersLabel(organizers.length)} v obci ${municipalityName}`
            : municipalityName
              ? `Obec ${municipalityName}`
              : undefined
        }
      />
      <div className="space-y-5 px-4 py-5">
        {municipalities.length > 1 && (
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" role="tablist" aria-label="Obec">
            {municipalities.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={m.id === municipalityId}
                onClick={() => setMunicipalityId(m.id)}
                className={cn(
                  "shrink-0 rounded-full border-[1.5px] px-4 py-2 text-sm font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  m.id === municipalityId
                    ? "border-primary bg-brand-purple-pale text-brand-purple-dark"
                    : "border-border bg-card hover:border-brand-purple",
                )}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}

        {error ? (
          <EmptyState icon={Store} title="Pořadatele se nepodařilo načíst" description="Obnovte stránku, nebo to zkuste za chvíli." />
        ) : !municipalityId || organizers === null ? (
          <Loading />
        ) : organizers.length === 0 ? (
          <EmptyState
            icon={Store}
            title="V obci zatím nikdo další akce nepořádá"
            description="Jakmile obec schválí první žádost o roli organizátora, jeho profil se objeví tady."
          />
        ) : (
          <>
            {typeOptions.length > 1 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Typ pořadatele">
                {[{ value: ALL, label: "Všichni" }, ...typeOptions].map((t) => {
                  const active = type === t.value;
                  const count = t.value === ALL ? organizers.length : typeCounts.get(t.value) ?? 0;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setType(t.value)}
                      className={cn(
                        "rounded-full border-[1.5px] px-3 py-1.5 text-sm font-semibold transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card hover:border-brand-purple",
                      )}
                    >
                      {t.label} <span className={cn("tabular-nums", !active && "text-muted-foreground")}>{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <ul className="grid gap-4 lg:grid-cols-2">
              {shown.map((o) => (
                <li key={o.id}>
                  <OrganizerProfile organizer={o} onOpen={() => setOpenId(o.id)} />
                </li>
              ))}
            </ul>
            <OrganizerDetailDialog
              organizer={organizers.find((o) => o.id === openId) ?? null}
              onOpenChange={(open) => !open && setOpenId(null)}
            />
          </>
        )}
        {user && !error && organizers && organizers.length > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            Čísla jsou ze všech akcí, které pořadatel v obci pořádá nebo spolupořádá. Hodnocení od účastníků vidí jen
            on sám.
          </p>
        )}
      </div>
    </div>
  );
}

export default function OrganizersPage() {
  return (
    <RequireAuth>
      <RequireRole role="organizer">
        <Suspense fallback={<Loading />}>
          <OrganizersContent />
        </Suspense>
      </RequireRole>
    </RequireAuth>
  );
}
