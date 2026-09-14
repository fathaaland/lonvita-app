"use client";

import Link from "next/link";
import { Calendar, MapPin } from "lucide-react";
import { getCategoryIcon } from "@/lib/icons";
import { relativeDay, formatEventTime } from "@/lib/date";
import { formatCzk } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface EventCardData {
  id: string;
  title: string;
  date_time: string;
  location_text: string;
  capacity: number;
  image_url: string | null;
  registrations_count?: number;
  categories?: { id: string; name: string; icon: string; color: string }[];
  is_paid?: boolean;
  price_cents?: number | null;
  /** Shown next to the location when events from several municipalities are listed together. */
  municipality_name?: string;
}

export function EventCard({ event, className }: { event: EventCardData; className?: string }) {
  const primaryCategory = event.categories?.[0];
  const Icon = getCategoryIcon(primaryCategory?.icon);
  const free = Math.max(0, event.capacity - (event.registrations_count ?? 0));
  const priceLabel = event.is_paid ? (event.price_cents ? formatCzk(event.price_cents) : "Placená") : null;

  return (
    <Link
      href={`/akce/${event.id}`}
      className={cn(
        "group block bg-card rounded-2xl overflow-hidden border border-border shadow-sm",
        "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]",
        className,
      )}
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
        {event.image_url ? (
          <img
            src={event.image_url}
            alt={event.title}
            loading="lazy"
            width={512}
            height={320}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-brand-purple-pale">
            <Icon className="h-16 w-16 text-brand-purple-dark" />
          </div>
        )}
        <div className="absolute top-3 right-3 inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold bg-card/95 text-foreground shadow-sm">
          {relativeDay(event.date_time)}
        </div>
      </div>

      <div className="p-4 space-y-2">
        {event.categories && event.categories.length > 0 && (
          <div className="eyebrow flex items-center gap-1 flex-wrap">
            <Icon className="h-3 w-3" />
            {event.categories.map((c) => c.name).join(", ")}
          </div>
        )}
        <h3 className="font-display text-xl leading-snug line-clamp-2">{event.title}</h3>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4 shrink-0" />
          <span className="truncate">{formatEventTime(event.date_time)}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {event.municipality_name && <span className="font-semibold text-foreground">{event.municipality_name} · </span>}
            {event.location_text}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-brand-sand-pale">
          {priceLabel ? (
            <span className="text-sm font-bold text-foreground">{priceLabel}</span>
          ) : (
            <span className="text-sm font-bold text-[hsl(var(--success))]">Zdarma</span>
          )}
          <span className={cn(
            "text-xs font-semibold",
            free > 0 ? "text-muted-foreground" : "text-destructive",
          )}>
            {free > 0 ? `Volných míst: ${free}` : "Plno"}
          </span>
        </div>
      </div>
    </Link>
  );
}
