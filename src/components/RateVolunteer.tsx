"use client";

import { useState } from "react";
import { toast } from "sonner";
import { rateVolunteer, VolunteerRatingRow } from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { RatingStars } from "@/components/RatingStars";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** The rating the event's pořadatel gave a volunteer who helped — stars and an optional note, kept
 * on the volunteer's card. Given once, after a confirmation; from then on it's only shown. Only the
 * pořadatel who founded the event gets the form (`canRate`); everyone else sees what was given. */
export function RateVolunteer({
  registrationId,
  name,
  existing,
  canRate,
  onSaved,
}: {
  registrationId: string;
  name: string;
  existing: VolunteerRatingRow | null;
  canRate: boolean;
  onSaved: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  if (existing) {
    return (
      <div className="space-y-0.5 rounded-lg bg-muted/60 px-3 py-2">
        <p className="text-xs font-semibold text-muted-foreground">Hodnocení dobrovolníka</p>
        <RatingStars value={existing.rating} size="sm" label={`Hodnocení ${name}`} />
        {existing.comment && <p className="text-sm">„{existing.comment}“</p>}
      </div>
    );
  }

  if (!canRate) {
    return <p className="text-xs text-muted-foreground">Dobrovolníka ohodnotí pořadatel, který akci založil.</p>;
  }

  const save = async () => {
    setSaving(true);
    try {
      await rateVolunteer(registrationId, rating, comment);
      toast.success("Hodnocení uloženo. Ostatní pořadatelé ho uvidí na kartě dobrovolníka.");
      setConfirming(false);
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
      <Button
        className="h-10 w-full"
        onClick={() => (rating === 0 ? toast.error("Vyberte počet hvězdiček.") : setConfirming(true))}
      >
        Uložit hodnocení
      </Button>

      <AlertDialog open={confirming} onOpenChange={(open) => !saving && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uložit hodnocení dobrovolníka?</AlertDialogTitle>
            <AlertDialogDescription>
              {name} dostane od vás {rating} z 5 hvězdiček. Hodnocení se ukáže na jeho kartě dobrovolníka a pak už ho
              nepůjde změnit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-center py-1">
            <RatingStars value={rating} label="Vaše hodnocení" />
          </div>
          {comment.trim() && <p className="text-center text-sm">„{comment.trim()}“</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Zpět</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(e) => {
                e.preventDefault();
                save();
              }}
            >
              {saving ? "Ukládám…" : "Uložit natrvalo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
