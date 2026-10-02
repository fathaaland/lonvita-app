"use client";

import { useState } from "react";
import { toast } from "sonner";
import { rateVolunteer, VolunteerRatingRow } from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { RatingStars } from "@/components/RatingStars";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** The organizer's rating of a volunteer who helped on the event — stars and an optional note, kept
 * on the volunteer's card (organizers see the average on the volunteer map). Can be changed later. */
export function RateVolunteer({
  registrationId,
  name,
  existing,
  onSaved,
}: {
  registrationId: string;
  name: string;
  existing: VolunteerRatingRow | null;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(!existing);
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [saving, setSaving] = useState(false);

  if (existing && !editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2">
        <div className="space-y-0.5">
          <RatingStars value={existing.rating} size="sm" label={`Vaše hodnocení ${name}`} />
          {existing.comment && <p className="text-sm">„{existing.comment}“</p>}
        </div>
        <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditing(true)}>
          Změnit
        </Button>
      </div>
    );
  }

  const save = async () => {
    if (rating === 0) return toast.error("Vyberte počet hvězdiček.");
    setSaving(true);
    try {
      await rateVolunteer(registrationId, rating, comment, existing?.id);
      toast.success("Hodnocení uloženo. Uvidí ho ostatní pořadatelé na kartě dobrovolníka.");
      setEditing(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Hodnocení se nepodařilo uložit.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border-[1.5px] border-primary/40 p-3">
      <p className="text-xs font-semibold text-muted-foreground">Jak vám {name} pomohl/a?</p>
      <RatingStars value={rating} onChange={setRating} label={`Hodnocení dobrovolníka ${name}`} />
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Krátká poznámka pro ostatní pořadatele (nepovinné)"
        maxLength={500}
        rows={2}
      />
      <div className="flex gap-2">
        {existing && (
          <Button variant="outline" className="h-10" onClick={() => setEditing(false)} disabled={saving}>
            Zrušit
          </Button>
        )}
        <Button className="h-10 flex-1" onClick={save} disabled={saving}>
          {saving ? "Ukládám…" : "Uložit hodnocení"}
        </Button>
      </div>
    </div>
  );
}
