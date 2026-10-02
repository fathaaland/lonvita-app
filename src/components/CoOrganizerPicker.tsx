"use client";

import { useEffect, useState } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown, UserPlus, X } from "lucide-react";
import { listCoOrganizerCandidates, CoOrganizerCandidate, OrganizationRef } from "@/integrations/payload/queries";
import { MUNICIPALITY_ORGANIZATION_TYPE, organizationTypeLabel } from "@/lib/organizations";
import { OrganizationMark } from "@/components/EventCard";
import { cn } from "@/lib/utils";

interface Props {
  municipalityId: string;
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
  /** The event is the obec's own — it can't co-organize it as well. */
  excludeObec?: boolean;
}

const isObec = (o: { type: string }) => o.type === MUNICIPALITY_ORGANIZATION_TYPE;

/** Brief §4 "Spolupořadatelství" — pick from this obec's organizations (the obec itself always
 * first, then a café, a club, one person's "Vycházky pro seniory") whom to invite as co-organizers
 * (CoOrganizingRequests). Each joins only once it accepts. */
export function CoOrganizerPicker({
  municipalityId,
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
    listCoOrganizerCandidates(municipalityId)
      .then((rows) => active && setCandidates(rows))
      .catch(() => active && setCandidates([]));
    return () => {
      active = false;
    };
  }, [municipalityId]);

  // Picked organizations come from the event without a photo when it was saved before they set one.
  const avatarById = new Map((candidates ?? []).map((c) => [c.id, c.avatar_url]));
  const pickedIds = new Set(value.map((v) => v.id));
  const options = (candidates ?? []).filter(
    (c) =>
      !pickedIds.has(c.id) &&
      !excludeIds.includes(c.id) &&
      !(excludeOwnerId && c.owner_id === excludeOwnerId) &&
      !(excludeObec && isObec(c)),
  );
  const obecOption = options.find(isObec);
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
        ? "Další organizace v obci zatím nejsou"
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
                  <button
                    type="button"
                    onClick={() => remove(v.id)}
                    aria-label={`Odebrat ${v.name}`}
                    className="-mr-1 rounded-full p-1 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* An "add" control rather than a value: picking an option adds it above and resets to the prompt. */}
      <SelectPrimitive.Root value="" onValueChange={add} disabled={options.length === 0}>
        <SelectPrimitive.Trigger
          className={cn(
            "flex h-12 w-full items-center gap-2.5 rounded-lg border-[1.5px] border-border bg-card px-3.5 text-left text-sm font-semibold",
            "transition-colors hover:border-brand-purple data-[state=open]:border-brand-purple",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:font-normal disabled:text-muted-foreground disabled:hover:border-border",
          )}
        >
          <UserPlus className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="flex-1 truncate">
            <SelectPrimitive.Value placeholder={placeholder} />
          </span>
          <SelectPrimitive.Icon asChild>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={6}
            className={cn(
              "relative z-50 max-h-[min(24rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] overflow-hidden",
              "rounded-lg border border-border bg-popover text-popover-foreground shadow-lg",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none",
            )}
          >
            <SelectPrimitive.Viewport className="p-1.5">
              {obecOption && (
                <SelectPrimitive.Item
                  value={obecOption.id}
                  className="flex cursor-pointer select-none items-center gap-3 rounded-md bg-primary-soft px-2.5 py-2.5 outline-none data-[highlighted]:ring-2 data-[highlighted]:ring-inset data-[highlighted]:ring-primary"
                >
                  <OrganizationMark organization={obecOption} className="h-10 w-10 ring-0 text-xs" />
                  <span className="min-w-0">
                    <SelectPrimitive.ItemText>
                      <span className="block truncate text-sm font-semibold">{obecOption.name}</span>
                    </SelectPrimitive.ItemText>
                    <span className="block text-xs text-muted-foreground">
                      Obec — po přijetí akci upravuje a ruší už jen obec
                    </span>
                  </span>
                </SelectPrimitive.Item>
              )}
              {obecOption && otherOptions.length > 0 && (
                <SelectPrimitive.Separator className="mx-1 my-1.5 h-px bg-border" />
              )}
              {otherOptions.length > 0 && (
                <SelectPrimitive.Group>
                  <SelectPrimitive.Label className="px-2.5 pb-1 pt-0.5 text-xs font-semibold text-muted-foreground">
                    Pořadatelé v obci
                  </SelectPrimitive.Label>
                  {otherOptions.map((o) => (
                    <SelectPrimitive.Item
                      key={o.id}
                      value={o.id}
                      className="flex cursor-pointer select-none items-center gap-3 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-muted"
                    >
                      <OrganizationMark organization={o} className="h-9 w-9 ring-0 text-xs" />
                      <span className="min-w-0">
                        <SelectPrimitive.ItemText>
                          <span className="block truncate text-sm font-semibold">{o.name}</span>
                        </SelectPrimitive.ItemText>
                        <span className="block text-xs text-muted-foreground">{organizationTypeLabel(o.type)}</span>
                      </span>
                    </SelectPrimitive.Item>
                  ))}
                </SelectPrimitive.Group>
              )}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}
