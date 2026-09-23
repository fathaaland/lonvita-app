"use client";

import { useEffect, useState } from "react";
import { searchCoOrganizerCandidates, MunicipalityUserRow } from "@/integrations/payload/queries";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

interface Props {
  municipalityId: string;
  /** Ids of already-picked co-organizers, plus their names for display without a lookup. */
  value: { id: string; full_name: string }[];
  onChange: (value: { id: string; full_name: string }[]) => void;
  /** The primary organizer and the current user can't also be added as co-organizers. */
  excludeUserIds: string[];
}

/** Brief §4 "Spolupořadatelství" — search this obec's pořadatelé and admins by name and add
 * them as additional organizers of the event (Events.coOrganizers). */
export function CoOrganizerPicker({ municipalityId, value, onChange, excludeUserIds }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MunicipalityUserRow[]>([]);
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

  const add = (user: MunicipalityUserRow) => {
    onChange([...value, { id: user.id, full_name: user.full_name }]);
    setQuery("");
    setResults([]);
  };

  const remove = (id: string) => {
    onChange(value.filter((v) => v.id !== id));
  };

  const pickedIds = new Set(value.map((v) => v.id));
  const visibleResults = results.filter((r) => !pickedIds.has(r.id) && !excludeUserIds.includes(r.id));

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <Badge key={v.id} variant="secondary" className="gap-1 pr-1 h-8">
              {v.full_name}
              <button type="button" onClick={() => remove(v.id)} aria-label="Odebrat" className="ml-0.5 hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Hledat podle jména…"
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
              <span className="font-semibold">{r.full_name}</span>
              {r.email && <span className="text-muted-foreground"> · {r.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
