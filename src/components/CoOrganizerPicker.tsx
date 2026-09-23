"use client";

import { useEffect, useState } from "react";
import { searchCoOrganizerCandidates, OrganizationRef } from "@/integrations/payload/queries";
import { MUNICIPALITY_ORGANIZATION_TYPE, organizationTypeLabel } from "@/lib/organizations";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

interface Props {
  municipalityId: string;
  /** Already-picked co-organizing organizations. */
  value: OrganizationRef[];
  onChange: (value: OrganizationRef[]) => void;
  /** Organizations that can't be added — the event's own (its organizer's). */
  excludeIds: string[];
  /** Already-saved co-organizations the current user isn't allowed to remove. */
  fixedIds?: string[];
  /** The event is the obec's own — it can't co-organize it as well. */
  excludeObec?: boolean;
}

/** Brief §4 "Spolupořadatelství" — search this obec's organizations (a café, a club, one person's
 * "Vycházky pro seniory") by name and add them as co-organizers (Events.coOrganizations). */
export function CoOrganizerPicker({ municipalityId, value, onChange, excludeIds, fixedIds = [], excludeObec = false }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OrganizationRef[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    setSearching(true);
    const timeout = setTimeout(() => {
      searchCoOrganizerCandidates(municipalityId, query)
        .then((rows) => {
          if (active) setResults(rows);
        })
        .catch(() => active && setResults([]))
        .finally(() => active && setSearching(false));
    }, 300);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [query, municipalityId]);

  const add = (organization: OrganizationRef) => {
    onChange([...value, organization]);
    setQuery("");
    setResults([]);
  };

  const remove = (id: string) => {
    onChange(value.filter((v) => v.id !== id));
  };

  const pickedIds = new Set(value.map((v) => v.id));
  const visibleResults = results.filter(
    (r) =>
      !pickedIds.has(r.id) && !excludeIds.includes(r.id) && !(excludeObec && r.type === MUNICIPALITY_ORGANIZATION_TYPE),
  );

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <Badge key={v.id} variant="secondary" className="gap-1 pr-1 h-8">
              {v.name}
              {!fixedIds.includes(v.id) && (
                <button type="button" onClick={() => remove(v.id)} aria-label="Odebrat" className="ml-0.5 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Hledat podle názvu…"
        className="h-11"
      />
      {searching && <p className="text-xs text-muted-foreground">Hledám…</p>}
      {visibleResults.length > 0 && (
        <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
          {visibleResults.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => add(r)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
            >
              <span className="font-semibold">{r.name}</span>
              <span className="text-muted-foreground"> · {organizationTypeLabel(r.type)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
