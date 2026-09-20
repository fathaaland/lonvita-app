"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MunicipalitiesMap } from "@/components/map/MunicipalitiesMapClient";
import type { MunicipalityMapPoint } from "@/components/map/MunicipalitiesMap";
import { cn } from "@/lib/utils";

export type MunicipalityChoice = {
  /** The chosen obec, or "" when none is chosen. */
  id: string;
  /** "Moje obec tu zatím není" — browse events from every obec instead. */
  noMunicipality: boolean;
};

interface Props {
  points: MunicipalityMapPoint[];
  value: MunicipalityChoice;
  onChange: (value: MunicipalityChoice) => void;
  id?: string;
}

/**
 * Picking your obec is the one decision that makes Lonvita local, so it gets a control of its
 * own instead of a map dropped into the middle of the sign-up form: a single field that opens
 * the map full-size in a dialog and then shows what you chose. Three states, one control — not
 * yet chosen, an obec, or "my town isn't here" (which the dialog offers, rather than a stray
 * checkbox sitting under the form).
 */
export function MunicipalityPicker({ points, value, onChange, id }: Props) {
  const [open, setOpen] = useState(false);
  // The dialog holds a draft of the choice: nothing lands on the form until it's confirmed, so
  // a mis-tapped pin costs nothing.
  const [draftId, setDraftId] = useState(value.id);

  useEffect(() => {
    if (open) setDraftId(value.id);
  }, [open, value.id]);

  const chosenName = points.find((p) => p.id === value.id)?.name;
  const draftName = points.find((p) => p.id === draftId)?.name;
  const resolved = Boolean(chosenName) || value.noMunicipality;

  const confirm = (next: MunicipalityChoice) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        id={id}
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-14 w-full items-center gap-3 rounded-2xl border px-4 text-left transition-colors",
          "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          resolved
            ? "border-success/40 bg-success-soft text-foreground"
            : "border-input bg-background hover:border-primary",
        )}
      >
        <MapPin className={cn("h-5 w-5 shrink-0", resolved ? "text-foreground" : "text-muted-foreground")} />
        <span className="min-w-0 flex-1 truncate text-base">
          {chosenName ? (
            <span className="font-semibold">{chosenName}</span>
          ) : value.noMunicipality ? (
            <span className="font-semibold">Moje obec tu zatím není</span>
          ) : (
            <span className="text-muted-foreground">Vyberte obec na mapě</span>
          )}
        </span>
        {resolved ? (
          <span className="shrink-0 text-sm font-semibold text-primary">Změnit</span>
        ) : (
          <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[min(56rem,calc(100vw-2rem))] gap-5 overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">Kde bydlíte?</DialogTitle>
            <DialogDescription className="text-base">
              Klepněte na tečku své obce. Budete pak vidět akce, které se v ní konají.
            </DialogDescription>
          </DialogHeader>

          <MunicipalitiesMap
            points={points}
            selectedId={draftId || null}
            onSelect={setDraftId}
            className="h-[min(56vh,28rem)] min-h-[13rem] w-full overflow-hidden rounded-2xl border border-border"
          />

          <DialogFooter className="items-center gap-3 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="h-12 px-3 text-base font-semibold text-muted-foreground hover:text-foreground"
              onClick={() => confirm({ id: "", noMunicipality: true })}
            >
              Moje obec tu zatím není
            </Button>
            <Button
              type="button"
              className="h-12 px-6 text-base font-semibold"
              disabled={!draftId}
              onClick={() => confirm({ id: draftId, noMunicipality: false })}
            >
              <Check className="h-5 w-5" />
              {draftName ? `Vybrat ${draftName}` : "Vyberte obec"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
