"use client";

import { useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { decideReviewComplaint, ReviewComplaintAdminRow } from "@/integrations/payload/admin-queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { RatingStars } from "@/components/RatingStars";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const NOTE_MAX_LENGTH = 500;

/** One complaint in the obec's queue: the review as it stands, who reported it and why — and the
 * two ways to settle it, each confirmed with an optional reason the complainant gets to read. */
export function ReviewComplaintCard({
  complaint,
  onDecided,
}: {
  complaint: ReviewComplaintAdminRow;
  onDecided: () => void;
}) {
  const [deciding, setDeciding] = useState<"uphold" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const { review } = complaint;
  const isRating = complaint.review_type === "volunteer-rating";

  const close = () => {
    if (saving) return;
    setDeciding(null);
    setNote("");
  };

  const decide = async () => {
    if (!deciding) return;
    setSaving(true);
    try {
      await decideReviewComplaint(complaint.id, deciding === "uphold", note);
      toast.success(deciding === "uphold" ? "Recenze odstraněna. Hodnocení se přepočítalo." : "Recenze zůstává.");
      setDeciding(null);
      setNote("");
      onDecided();
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status < 500 ? error.message : "Stížnost se nepodařilo vyřídit.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm">
            {isRating ? `Hodnocení dobrovolníka ${review?.subject_name ?? ""}`.trim() : `Recenze pro ${review?.subject_name ?? "pořadatele"}`}
          </p>
          <p className="text-xs text-muted-foreground">
            {complaint.event_id ? (
              <a href={`/akce/${complaint.event_id}`} className="hover:underline">
                {complaint.event_title}
              </a>
            ) : (
              complaint.event_title
            )}
          </p>
        </div>

        {review ? (
          <div className="space-y-1 rounded-lg bg-muted/60 px-3 py-2">
            <RatingStars value={review.rating} size="sm" label="Hodnocení v recenzi" />
            {review.comment ? (
              <p className="text-sm whitespace-pre-line break-words">„{review.comment}“</p>
            ) : (
              <p className="text-xs italic text-muted-foreground">Bez komentáře.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Napsal(a) {review.author_name}, {new Date(review.created_at).toLocaleDateString("cs-CZ")}
            </p>
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">Recenze už neexistuje — stížnost stačí uzavřít.</p>
        )}

        <div className="space-y-1">
          <p className="text-xs font-semibold">
            Nahlásil(a) {complaint.complainant_name}, {new Date(complaint.created_at).toLocaleDateString("cs-CZ")}
          </p>
          <p className="text-sm whitespace-pre-line break-words">{complaint.reason}</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            size="sm"
            variant="outline"
            className="h-9 sm:flex-1 text-destructive border-destructive/40"
            onClick={() => setDeciding("uphold")}
          >
            <Trash2 className="h-4 w-4" /> Odstranit recenzi
          </Button>
          <Button size="sm" variant="outline" className="h-9 sm:flex-1" onClick={() => setDeciding("reject")}>
            <Check className="h-4 w-4" /> Ponechat recenzi
          </Button>
        </div>
      </CardContent>

      <Dialog open={deciding !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{deciding === "uphold" ? "Odstranit recenzi?" : "Ponechat recenzi?"}</DialogTitle>
            <DialogDescription>
              {deciding === "uphold"
                ? `Recenze zmizí a přestane se počítat do hodnocení ${isRating ? "dobrovolníka" : "pořadatele"}. Vrátit to nejde.`
                : "Recenze zůstane a stížnost na ni už nepůjde podat znovu."}{" "}
              {complaint.complainant_name} dostane oznámení.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor={`note-${complaint.id}`}>Zdůvodnění (nepovinné)</Label>
            <Textarea
              id={`note-${complaint.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={NOTE_MAX_LENGTH}
              rows={3}
            />
          </div>

          <DialogFooter className="gap-2 sm:flex-col sm:space-x-0">
            <Button
              className="w-full h-11"
              variant={deciding === "uphold" ? "destructive" : "default"}
              onClick={decide}
              disabled={saving}
            >
              {saving ? "Ukládám…" : deciding === "uphold" ? "Odstranit recenzi" : "Ponechat recenzi"}
            </Button>
            <Button variant="ghost" className="w-full h-11 text-muted-foreground" onClick={close} disabled={saving}>
              Zpět
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
