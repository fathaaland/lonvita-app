"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Mail, Phone } from "lucide-react";
import { getOrganizerContact, OrganizerContact } from "@/integrations/payload/queries";
import { initialsOf } from "@/components/UserAvatar";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/**
 * The event's pořadatel to call or e-mail — once it's too late to sign up for the event or cancel
 * one's registration in the app (REGISTRATION_CUTOFF_HOURS before the start). Folds into one row
 * ("Kontaktovat pořadatele") and opens onto two big tap targets, calling first. Loaded on mount; the
 * route decides who may see it (/api/events/:id/organizer-contact).
 */
export function OrganizerContactCard({ eventId }: { eventId: string }) {
  const [contact, setContact] = useState<OrganizerContact | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getOrganizerContact(eventId)
      .then(setContact)
      .catch(() => setContact({ name: null, email: null, phone: null }));
  }, [eventId]);

  const loading = contact === null;
  const unavailable = !!contact && !contact.phone && !contact.email;
  const name = contact?.name ?? "Pořadatel";

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} disabled={loading || unavailable}>
      <section aria-label="Kontakt na pořadatele" className="overflow-hidden rounded-2xl border border-border bg-card">
        <CollapsibleTrigger className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent">
          <span
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-brand-purple-dark"
          >
            {loading ? "" : initialsOf(name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold leading-tight">Kontaktovat pořadatele</span>
            <span className="block truncate text-sm text-muted-foreground">
              {loading ? "Načítám kontakt…" : unavailable ? "Kontakt se nepodařilo načíst" : name}
            </span>
          </span>
          {!loading && !unavailable && (
            <ChevronDown
              aria-hidden
              className={cn(
                "h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                open && "rotate-180",
              )}
            />
          )}
        </CollapsibleTrigger>

        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
          <div className="space-y-1 border-t border-border p-2">
            {contact?.phone && (
              <ContactRow
                href={`tel:${contact.phone.replace(/\s/g, "")}`}
                icon={Phone}
                label="Zavolat"
                value={contact.phone}
                primary
              />
            )}
            {contact?.email && (
              <ContactRow href={`mailto:${contact.email}`} icon={Mail} label="Napsat e-mail" value={contact.email} />
            )}
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function ContactRow({
  href,
  icon: Icon,
  label,
  value,
  primary = false,
}: {
  href: string;
  icon: typeof Phone;
  label: string;
  value: string;
  primary?: boolean;
}) {
  return (
    <a
      href={href}
      className="flex min-h-14 items-center gap-3 rounded-xl p-2 transition-colors hover:bg-primary-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
          primary ? "bg-primary text-primary-foreground" : "bg-primary-soft text-brand-purple-dark",
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-muted-foreground">{label}</span>
        <span className="block break-all text-lg font-semibold leading-snug text-primary">{value}</span>
      </span>
    </a>
  );
}
