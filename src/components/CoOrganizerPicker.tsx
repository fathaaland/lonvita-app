"use client";

import { useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { listCoOrganizerCandidates, CoOrganizerCandidate, OrganizationRef } from "@/integrations/payload/queries";
import { MUNICIPALITY_ORGANIZATION_TYPE, organizationTypeLabel } from "@/lib/organizations";
import { OrganizationMark } from "@/components/EventCard";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  municipalityId: string;
  /** The event being edited, if any — lets a neighbour from the mikroregion list the candidates too. */
  eventId?: string;
  /** Already-picked co-organizing organizations — on the event, invited, or about to be. */
  value: OrganizationRef[];
  onChange: (value: OrganizationRef[]) => void;
  /** Organizations that can't be added — the event's own (its organizer's). */
  excludeIds: string[];
  /** Whose organization runs the event — it can't co-organize it too. */
  excludeOwnerId?: string;
  /** Already-saved co-organizations the current user isn't allowed to remove. */
  fixedIds?: string[];
  /** Invited organizations that haven't answered yet. */
  pendingIds?: string[];
  /** The event's own obec can't be invited — it runs the event, its admin is the one inviting, or it
   * has left it. The other obce of its mikroregion still can. */
  excludeObec?: boolean;
}

const isObec = (o: { type: string }) => o.type === MUNICIPALITY_ORGANIZATION_TYPE;

/** Brief §4 "Spolupořadatelství" — pick from the organizations of this obec and its mikroregion (the
 * obec itself first, then the neighbouring obce, then a café, a club, one person's "Vycházky pro
 * seniory") whom to invite as co-organizers (CoOrganizingRequests). Each joins only once it accepts. */
export function CoOrganizerPicker({
  municipalityId,
  eventId,
  value,
  onChange,
  excludeIds,
  excludeOwnerId,
  fixedIds = [],
  pendingIds = [],
  excludeObec = false,
}: Props) {
  const [candidates, setCandidates] = useState<CoOrganizerCandidate[] | null>(null);

  useEffect(() => {
    if (!municipalityId) return;
    let active = true;
    setCandidates(null);
    listCoOrganizerCandidates(municipalityId, eventId)
      .then((rows) => active && setCandidates(rows))
      .catch(() => active && setCandidates([]));
    return () => {
      active = false;
    };
  }, [municipalityId, eventId]);

  // Picked organizations come from the event without a photo when it was saved before they set one.
  const avatarById = new Map((candidates ?? []).map((c) => [c.id, c.avatar_url]));
  const pickedIds = new Set(value.map((v) => v.id));
  const options = (candidates ?? []).filter(
    (c) =>
      !pickedIds.has(c.id) &&
      !excludeIds.includes(c.id) &&
      !(excludeOwnerId && c.owner_id === excludeOwnerId) &&
      !(excludeObec && isObec(c) && c.municipality_id === municipalityId),
  );
  // The event's own obec first, then its neighbours in the mikroregion (the server sorts them so).
  const obecOptions = options.filter(isObec);
  const otherOptions = options.filter((o) => !isObec(o));

  const add = (id: string) => {
    const picked = options.find((o) => o.id === id);
    if (picked) onChange([...value, picked]);
  };

  const remove = (id: string) => {
    onChange(value.filter((v) => v.id !== id));
  };

  const placeholder =
    candidates === null
      ? "Načítám organizace…"
      : options.length === 0
        ? "Další organizace zatím nejsou"
        : "Pozvat spolupořadatele";

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Spolupořadatelé">
          {value.map((v) => {
            const pending = pendingIds.includes(v.id);
            return (
              <li
                key={v.id}
                className={cn(
                  "flex h-10 items-center gap-2 rounded-full pl-1 pr-3 text-sm font-semibold",
                  pending ? "border-[1.5px] border-dashed border-primary bg-card" : "bg-secondary",
                )}
              >
                <OrganizationMark
                  organization={{ ...v, avatar_url: v.avatar_url ?? avatarById.get(v.id) }}
                  className="h-8 w-8 ring-0 text-xs"
                />
                <span>{v.name}</span>
                {pending && <span className="font-normal text-muted-foreground">čeká na souhlas</span>}
                {!fixedIds.includes(v.id) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(v.id)}
                    aria-label={`Odebrat ${v.name}`}
                    className="-mr-1 h-6 w-6 rounded-full text-muted-foreground hover:bg-transparent hover:text-destructive [&_svg]:size-3.5"
                  >
                    <X />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* An "add" control rather than a value: picking an option adds it above and resets to the prompt. */}
      <Select value="" onValueChange={add} disabled={options.length === 0}>
        <SelectTrigger
          className={cn(
            "h-12 gap-2.5 rounded-lg border-[1.5px] border-border bg-card px-3.5 text-left font-semibold ring-offset-0",
            "transition-colors hover:border-brand-purple focus:ring-offset-0 data-[state=open]:border-brand-purple",
            "disabled:font-normal disabled:text-muted-foreground disabled:opacity-100 disabled:hover:border-border",
          )}
        >
          <UserPlus className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="flex-1 truncate">
            <SelectValue placeholder={placeholder} />
          </span>
        </SelectTrigger>

        <SelectContent
          sideOffset={6}
          className="max-h-[min(24rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] rounded-lg border-border p-0.5 shadow-lg motion-reduce:animate-none"
        >
          {obecOptions.map((obec) => (
            <SelectItem
              key={obec.id}
              value={obec.id}
              className="mb-1 cursor-pointer gap-3 rounded-md bg-primary-soft px-2.5 py-2.5 last-of-type:mb-0 focus:bg-primary-soft focus:text-foreground data-[highlighted]:ring-2 data-[highlighted]:ring-inset data-[highlighted]:ring-primary"
            >
              <span className="flex min-w-0 items-center gap-3">
                <OrganizationMark organization={obec} className="h-10 w-10 ring-0 text-xs" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{obec.name}</span>

                  <span className="block text-xs text-muted-foreground">
                    {obec.municipality_id === municipalityId
                      ? "Obec — po přijetí akci upravuje a ruší už jen obec"
                      : "Sousední obec z mikroregionu — po přijetí může akci upravovat"}
                  </span>
                </span>
              </span>
            </SelectItem>
          ))}
          {obecOptions.length > 0 && otherOptions.length > 0 && <SelectSeparator className="mx-1 my-1.5 bg-border" />}
          {otherOptions.length > 0 && (
            <SelectGroup>
              <SelectLabel className="px-2.5 pb-1 pt-0.5 text-xs font-semibold text-muted-foreground">
                Pořadatelé
              </SelectLabel>
              {otherOptions.map((o) => (
                <SelectItem
                  key={o.id}
                  value={o.id}
                  className="cursor-pointer gap-3 rounded-md px-2.5 py-2 focus:bg-muted focus:text-foreground"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <OrganizationMark organization={o} className="h-9 w-9 ring-0 text-xs" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{o.name}</span>

                      <span className="block text-xs text-muted-foreground">{organizationTypeLabel(o.type)}</span>
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
