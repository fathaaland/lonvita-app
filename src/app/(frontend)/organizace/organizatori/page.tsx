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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ORGANIZATION_TYPES, organizationTypeLabel } from "@/lib/organizations";
import { formatPercent } from "@/lib/organization-stats";
import { cn } from "@/lib/utils";
import { useMunicipalityRegion } from "@/hooks/useMunicipalityRegion";
import { APP_TIME_ZONE, pragueYmd } from "@/lib/date";

const ALL = "all";

const organizersLabel = (n: number) =>
  n === 1 ? "1 pořadatel" : n >= 2 && n <= 4 ? `${n} pořadatelé` : `${n} pořadatelů`;

const eventsLabel = (n: number) => (n === 1 ? "akce" : n >= 2 && n <= 4 ? "akce" : "akcí");

const sinceLabel = (iso: string) =>
  `na Lonvitě od ${new Date(iso).toLocaleDateString("cs-CZ", { timeZone: APP_TIME_ZONE, month: "long", year: "numeric" })}`;

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
        <span className="block bg-primary py-px text-3xs font-semibold text-primary-foreground">
          {date.toLocaleDateString("cs-CZ", { timeZone: APP_TIME_ZONE, month: "short" }).replace(".", "")}
        </span>
        <span className="block py-0.5 text-lg font-extrabold leading-tight tabular-nums">{pragueYmd(date).day}</span>
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

function Byline({ organizer, homeId }: { organizer: OrganizerProfileRow; homeId: string | null }) {
  return (
    <>
      {homeId && organizer.municipality_id !== homeId && (
        <p className="mt-1 inline-block rounded-full bg-brand-purple-pale px-2 py-0.5 text-xs font-semibold text-brand-purple-dark">
          Z obce {organizer.municipality_name}
        </p>
      )}
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
    <Button
      asChild
      size="sm"
      className="shrink-0 gap-1.5 rounded-full bg-brand-purple-pale px-3 font-semibold text-brand-purple-dark hover:bg-primary-soft"
    >
      <Link href={`/organizace?organizace=${organizer.id}`}>
        <Pencil className="!size-3.5" aria-hidden /> Upravit profil
      </Link>
    </Button>
  );
}

/** One pořadatel in the directory — a preview; the whole profile with the contact opens in a dialog. */
function OrganizerProfile({
  organizer,
  homeId,
  onOpen,
}: {
  organizer: OrganizerProfileRow;
  /** The obec the directory is for — organizers from its neighbours say where they're from. */
  homeId: string | null;
  onOpen: () => void;
}) {
  return (
    <Card className={cn("h-full", organizer.is_own && "border-primary/50")}>
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <header className="flex items-start gap-3">
          <OrganizationMark organization={organizer} className="h-14 w-14 text-base ring-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-extrabold leading-tight break-words">
              <Button
                variant="link"
                onClick={onOpen}
                className="h-auto whitespace-normal p-0 text-left text-xl font-extrabold leading-tight text-foreground"
              >
                {organizer.name}
              </Button>
            </h2>
            <Byline organizer={organizer} homeId={homeId} />
          </div>
          {organizer.is_own && <EditOwnLink organizer={organizer} />}
        </header>

        {organizer.description ? (
          <p className="line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-foreground/85">
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
  homeId,
  onOpenChange,
}: {
  organizer: OrganizerProfileRow | null;
  homeId: string | null;
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
                      <Byline organizer={organizer} homeId={homeId} />
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
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/85">{organizer.description}</p>
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
  // "?obec=<id>" — opened from the Organizace page of an organization in that obec; "&organizace=<id>"
  // from the obec's list of its organizers, straight to that one's profile.
  const searchParams = useSearchParams();
  const requestedObec = searchParams.get("obec");
  const requestedOrganization = searchParams.get("organizace");

  const [municipalities, setMunicipalities] = useState<{ id: string; name: string }[]>([]);
  const [municipalityId, setMunicipalityId] = useState<string | null>(null);
  const [organizers, setOrganizers] = useState<OrganizerProfileRow[] | null>(null);
  const [error, setError] = useState(false);
  const [type, setType] = useState<string>(ALL);
  const [openId, setOpenId] = useState<string | null>(null);
  // Its neighbours in the mikroregion organize here too (they co-organize each other's events).
  const region = useMunicipalityRegion(municipalityId);
  const shared = !!region && region.municipalities.length > 1;
  const [onlyOwn, setOnlyOwn] = useState(false);

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
    setOnlyOwn(false);
    getMunicipalityOrganizers(municipalityId)
      .then((rows) => {
        if (!active) return;
        // Their own profile first — the one they come here to check.
        setOrganizers([...rows].sort((a, b) => Number(b.is_own) - Number(a.is_own)));
        if (requestedOrganization && rows.some((o) => o.id === requestedOrganization)) setOpenId(requestedOrganization);
      })
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [municipalityId, requestedOrganization]);

  const municipalityName = municipalities.find((m) => m.id === municipalityId)?.name;
  const inScope = useMemo(
    () => (organizers ?? []).filter((o) => !onlyOwn || o.municipality_id === municipalityId),
    [organizers, onlyOwn, municipalityId],
  );
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of inScope) counts.set(o.type, (counts.get(o.type) ?? 0) + 1);
    return counts;
  }, [inScope]);
  const shown = inScope.filter((o) => type === ALL || o.type === type);
  const where = shared && !onlyOwn ? `v mikroregionu ${region!.name}` : `v obci ${municipalityName}`;
  const typeOptions = ORGANIZATION_TYPES.filter((t) => typeCounts.has(t.value));

  return (
    <div className="animate-fade-in sm:mx-auto sm:max-w-5xl">
      <PageHeader
        back
        title="Organizátoři v mém městě"
        subtitle={
          municipalityName && organizers
            ? `${organizersLabel(inScope.length)} ${where}`
            : municipalityName
              ? `Obec ${municipalityName}`
              : undefined
        }
      />
      <div className="space-y-5 px-4 py-5">
        {municipalities.length > 1 && (
          <ToggleGroup
            type="single"
            variant="chip"
            size="chip"
            value={municipalityId ?? ""}
            onValueChange={(v) => v && setMunicipalityId(v)}
            className="-mx-4 flex-nowrap overflow-x-auto px-4 pb-1"
            aria-label="Obec"
          >
            {municipalities.map((m) => (
              <ToggleGroupItem
                key={m.id}
                value={m.id}
                className="shrink-0 px-4 data-[state=on]:border-primary data-[state=on]:bg-brand-purple-pale data-[state=on]:text-brand-purple-dark"
              >
                {m.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}

        {shared && organizers && organizers.length > 0 && (
          <Tabs
            value={onlyOwn ? "own" : "all"}
            onValueChange={(v) => {
              setOnlyOwn(v === "own");
              setType(ALL);
            }}
          >
            <TabsList className="h-11 w-full max-w-sm rounded-lg" aria-label="Odkud pořadatelé">
              <TabsTrigger value="all" className="h-9 flex-1 truncate font-semibold">
                Celý mikroregion
              </TabsTrigger>
              <TabsTrigger value="own" className="h-9 flex-1 truncate font-semibold">
                Jen {municipalityName}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        {error ? (
          <EmptyState icon={Store} title="Pořadatele se nepodařilo načíst" description="Obnovte stránku, nebo to zkuste za chvíli." />
        ) : !municipalityId || organizers === null ? (
          <Loading />
        ) : organizers.length === 0 ? (
          <EmptyState
            icon={Store}
            title={shared ? "V mikroregionu zatím nikdo další akce nepořádá" : "V obci zatím nikdo další akce nepořádá"}
            description="Jakmile obec schválí první žádost o roli organizátora, jeho profil se objeví tady."
          />
        ) : (
          <>
            {typeOptions.length > 1 && (
              <ToggleGroup
                type="single"
                variant="chip"
                value={type}
                onValueChange={(v) => v && setType(v)}
                aria-label="Typ pořadatele"
              >
                {[{ value: ALL, label: "Všichni" }, ...typeOptions].map((t) => {
                  const active = type === t.value;
                  const count = t.value === ALL ? inScope.length : typeCounts.get(t.value) ?? 0;
                  return (
                    <ToggleGroupItem key={t.value} value={t.value} className="gap-1 px-3 py-1.5">
                      {t.label} <span className={cn("tabular-nums", !active && "text-muted-foreground")}>{count}</span>
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            )}
            {inScope.length === 0 && (
              <p className="py-6 text-center text-muted-foreground">V obci {municipalityName} zatím nikdo další akce nepořádá.</p>
            )}
            <ul className="grid gap-4 lg:grid-cols-2">
              {shown.map((o) => (
                <li key={o.id}>
                  <OrganizerProfile organizer={o} homeId={shared ? municipalityId : null} onOpen={() => setOpenId(o.id)} />
                </li>
              ))}
            </ul>
            <OrganizerDetailDialog
              organizer={organizers.find((o) => o.id === openId) ?? null}
              homeId={shared ? municipalityId : null}
              onOpenChange={(open) => !open && setOpenId(null)}
            />
          </>
        )}
        {user && !error && organizers && organizers.length > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            Čísla jsou ze všech akcí, které pořadatel pořádá nebo spolupořádá. Hodnocení od účastníků vidí jen
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
