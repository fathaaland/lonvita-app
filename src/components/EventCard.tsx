"use client";

import Link from "next/link";
import { Clock, Landmark, MapPin } from "lucide-react";
import { getCategoryIcon } from "@/lib/icons";
import { relativeDay, formatEventTime } from "@/lib/date";
import { formatCzk } from "@/lib/money";
import { isUnlimitedCapacity } from "@/lib/capacity";
import { isMunicipalityOrganization } from "@/lib/organizations";
import { cn } from "@/lib/utils";

type CardOrganization = { id: string; name: string; type: string };

export interface EventCardData {
  id: string;
  title: string;
  date_time: string;
  location_text: string;
  capacity: number;
  image_url: string | null;
  /** The organizer's chosen framing of the photo in the 16:10 crop (percent); centred when absent. */
  image_position?: { x: number; y: number };
  registrations_count?: number;
  categories?: { id: string; name: string; icon: string; color: string }[];
  is_paid?: boolean;
  price_cents?: number | null;
  /** Shown next to the location when events from several municipalities are listed together. */
  municipality_name?: string;
  /** Who runs it — the pořadatel's organization (the obec's own one for the obec's events). */
  organization?: CardOrganization | null;
  co_organizations?: CardOrganization[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Zítra, 18:00" while it's close; the weekday once the date stub alone says which day. */
function whenLabel(iso: string): string {
  const date = new Date(iso);
  const days = Math.round((new Date(iso).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / DAY_MS);
  const day =
    days >= 0 && days <= 6
      ? relativeDay(iso)
      : date.toLocaleDateString("cs-CZ", { weekday: "long" }).replace(/^./, (c) => c.toUpperCase());
  return `${day}, ${formatEventTime(iso)}`;
}

function freePlacesLabel(free: number): string {
  if (free === 1) return "1 volné místo";
  if (free >= 2 && free <= 4) return `${free} volná místa`;
  return `${free} volných míst`;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w[0] ?? ""))
    .slice(0, 2)
    .map((w) => w[0]!.toLocaleUpperCase("cs"))
    .join("") || "?";

/** The organization's mark — the obec's town hall, everyone else's initials. Sized by `className`. */
export function OrganizationMark({
  organization,
  className,
}: {
  organization: { name: string; type: string };
  className?: string;
}) {
  const obec = isMunicipalityOrganization(organization);
  return (
    <span
      aria-hidden
      className={cn(
        "h-7 w-7 shrink-0 rounded-full ring-2 ring-card flex items-center justify-center text-[10px] font-bold",
        obec ? "bg-primary text-primary-foreground" : "bg-brand-sand-pale text-foreground",
        className,
      )}
    >
      {obec ? <Landmark className="h-[50%] w-[50%]" /> : initials(organization.name)}
    </span>
  );
}

/** "Hospoda U Lípy" + "spolupořádá obec Nové Veselí" — who's behind the event, at a glance. */
function Organizers({ organization, coOrganizations }: { organization?: CardOrganization | null; coOrganizations: CardOrganization[] }) {
  const all = [...(organization ? [organization] : []), ...coOrganizations];
  if (all.length === 0) return null;
  const [lead, ...rest] = all;
  const shown = rest.slice(0, 1).map((o) => o.name);
  const more = rest.length - shown.length;

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="flex -space-x-2 shrink-0">
        {all.slice(0, 3).map((o) => (
          <OrganizationMark key={o.id} organization={o} />
        ))}
      </div>
      <div className="min-w-0 leading-tight">
        <p className="text-sm font-semibold text-foreground truncate">{lead.name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {rest.length === 0 ? (
            "Pořadatel"
          ) : (
            <>
              {rest.length > 1 ? "spolupořádají" : "spolupořádá"} {shown.join(", ")}
              {more > 0 && ` a ${more} další`}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export function EventCard({ event, className }: { event: EventCardData; className?: string }) {
  const primaryCategory = event.categories?.[0];
  const Icon = getCategoryIcon(primaryCategory?.icon);
  const free = Math.max(0, event.capacity - (event.registrations_count ?? 0));
  const priceLabel = event.is_paid ? (event.price_cents ? formatCzk(event.price_cents) : "Placená") : null;
  const imagePosition = event.image_position ?? { x: 50, y: 50 };
  const date = new Date(event.date_time);

  return (
    <Link
      href={`/akce/${event.id}`}
      className={cn(
        "group flex flex-col h-full bg-card rounded-2xl overflow-hidden border border-border shadow-sm",
        "transition-shadow duration-200 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
        {event.image_url ? (
          <img
            src={event.image_url}
            alt=""
            loading="lazy"
            width={512}
            height={320}
            className="w-full h-full object-cover motion-safe:transition-transform motion-safe:duration-500 group-hover:scale-[1.03]"
            style={{ objectPosition: `${imagePosition.x}% ${imagePosition.y}%` }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-brand-purple-pale">
            <Icon className="h-14 w-14 text-brand-purple-dark" />
          </div>
        )}
        {/* A tear-off calendar leaf — the date is what people scan a list of events by. */}
        <div className="absolute bottom-3 left-3 w-14 rounded-xl bg-card text-center shadow-sm overflow-hidden">
          <div className="bg-primary text-primary-foreground text-[11px] font-semibold py-0.5">
            {date.toLocaleDateString("cs-CZ", { month: "short" }).replace(".", "")}
          </div>
          <div className="text-2xl font-extrabold leading-none tabular-nums py-1.5">{date.getDate()}</div>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4 gap-2.5">
        {event.categories && event.categories.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-brand-purple-dark min-w-0">
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{event.categories.map((c) => c.name).join(", ")}</span>
          </p>
        )}
        <h3 className="text-lg font-bold leading-snug line-clamp-2 [text-wrap:balance] break-words">{event.title}</h3>

        <div className="space-y-1 text-sm text-muted-foreground">
          <p className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0" />
            <span className="truncate">{whenLabel(event.date_time)}</span>
          </p>
          <p className="flex items-center gap-2 min-w-0">
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {event.municipality_name && <span className="font-semibold text-foreground">{event.municipality_name}, </span>}
              {event.location_text}
            </span>
          </p>
        </div>

        <div className="pt-1">
          <Organizers organization={event.organization} coOrganizations={event.co_organizations ?? []} />
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-3 border-t border-brand-sand-pale">
          {priceLabel ? (
            <span className="text-sm font-bold text-foreground">{priceLabel}</span>
          ) : (
            <span className="text-sm font-bold text-success">Zdarma</span>
          )}
          <span className={cn("text-xs font-semibold", free > 0 ? "text-muted-foreground" : "text-destructive")}>
            {isUnlimitedCapacity(event.capacity) ? "Bez omezení kapacity" : free > 0 ? freePlacesLabel(free) : "Obsazeno"}
          </span>
        </div>
      </div>
    </Link>
  );
}
