"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Send, UserRound } from "lucide-react";
import type { VolunteerRow } from "@/integrations/payload/queries";
import { MunicipalitiesMap } from "@/components/map/MunicipalitiesMapClient";
import type { MunicipalityMapPoint } from "@/components/map/MunicipalitiesMap";
import { focusLabel } from "@/components/VolunteerCard";
import { RatingBadge } from "@/components/RatingStars";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const volunteersLabel = (n: number) => (n === 1 ? "1 dobrovolník" : n < 5 ? `${n} dobrovolníci` : `${n} dobrovolníků`);

/** Best rated first, then those with more ratings; the not-yet-rated after. */
const byRating = (a: VolunteerRow, b: VolunteerRow) =>
  (b.rating?.average ?? 0) - (a.rating?.average ?? 0) || (b.rating?.count ?? 0) - (a.rating?.count ?? 0);

/**
 * "Najít dobrovolníka" — the same map as choosing your obec in onboarding, but its pins are the
 * obce volunteers help in, each with how many. Tapping one lists them, best rated first, with
 * "Pozvat" and their card.
 */
export function VolunteerMapDialog({
  open,
  onOpenChange,
  volunteers,
  viewerId,
  onInvite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  volunteers: VolunteerRow[];
  viewerId: string | null;
  onInvite: (volunteer: VolunteerRow) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (open) setSelectedId(null);
  }, [open]);

  const points = useMemo<MunicipalityMapPoint[]>(() => {
    const byPlace = new Map<string, MunicipalityMapPoint>();
    for (const v of volunteers) {
      if (!v.location) continue;
      const point = byPlace.get(v.location.id) ?? { ...v.location, count: 0 };
      point.count = (point.count ?? 0) + 1;
      byPlace.set(v.location.id, point);
    }
    return [...byPlace.values()];
  }, [volunteers]);

  const place = points.find((p) => p.id === selectedId) ?? null;
  const here = useMemo(
    () => volunteers.filter((v) => v.location?.id === selectedId).sort(byRating),
    [volunteers, selectedId],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[min(56rem,calc(100vw-2rem))] gap-5 overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">{place ? `Dobrovolníci · ${place.name}` : "Najít dobrovolníka"}</DialogTitle>
          <DialogDescription className="text-base">
            {place
              ? here.length === 1
                ? "1 dobrovolník tu pomáhá. Pozvěte ho na svou akci — rozhodne se sám."
                : `${volunteersLabel(here.length)} tu pomáhá. Pozvěte je na svou akci — rozhodnou se sami.`
              : points.length > 0
                ? "Číslo v kroužku je počet dobrovolníků, kteří v obci pomáhají. Klepněte na obec a uvidíte je."
                : "Zatím se do poolu nikdo nepřihlásil."}
          </DialogDescription>
        </DialogHeader>

        {place ? (
          <div className="space-y-3">
            <Button variant="ghost" className="-ml-2 h-10 px-2 font-semibold" onClick={() => setSelectedId(null)}>
              <ArrowLeft className="h-4 w-4" /> Zpět na mapu
            </Button>
            <ul className="space-y-2">
              {here.map((v) => (
                <li key={v.id} className="rounded-2xl border border-border bg-card p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    <UserAvatar
                      name={v.full_name}
                      src={v.avatar_url}
                      className="h-12 w-12 shrink-0"
                      fallbackClassName="bg-primary-soft text-brand-purple-dark font-bold"
                    />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <p className="font-bold text-base">{v.full_name}</p>
                        <RatingBadge rating={v.rating} />
                      </div>
                      {(v.volunteer_focus ?? []).length > 0 && (
                        <p className="text-sm text-muted-foreground">
                          {(v.volunteer_focus ?? []).map(focusLabel).join(", ")}
                        </p>
                      )}
                      {v.volunteer_note && <p className="text-sm">„{v.volunteer_note}“</p>}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button asChild variant="outline" className="h-11">
                      <Link href={`/dobrovolnik/${v.user_id}`}>
                        <UserRound className="h-4 w-4" /> Detail
                      </Link>
                    </Button>
                    <Button className="h-11" disabled={v.user_id === viewerId} onClick={() => onInvite(v)}>
                      <Send className="h-4 w-4" /> Pozvat
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <MunicipalitiesMap
            points={points}
            selectedId={selectedId}
            onSelect={setSelectedId}
            className="h-[min(56vh,28rem)] min-h-[13rem] w-full overflow-hidden rounded-2xl border border-border"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
