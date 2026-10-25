"use client";

import { useState } from "react";
import { Flag, Hourglass } from "lucide-react";
import { toast } from "sonner";

import { reportReview, ReviewComplaintStatus } from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { REVIEW_COMPLAINT_REASON_MAX_LENGTH, REVIEW_COMPLAINT_REASON_MIN_LENGTH } from "@/lib/validation";
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

/**
 * Under a review of the viewer — an event's feedback for its organizer, an organizer's rating for
 * the volunteer: where their complaint about it stands, or the button to report it. The obec decides
 * whether to remove it — or the platform admin, whenever the obec is a party to it (it runs the
 * event; lib/review-complaints complaintsDecidedByPlatform). Nothing when they may not report it.
 */
export function ReportReviewAction({
  type,
  reviewId,
  status,
  canComplain,
  decidedByPlatform = false,
  onReported,
}: {
  type: "event-feedback" | "volunteer-rating";
  reviewId: string;
  status: ReviewComplaintStatus;
  canComplain: boolean;
  /** The platform admin decides it, not the obec. */
  decidedByPlatform?: boolean;
  onReported: () => void;
}) {
  const decider = decidedByPlatform ? "Správce Lonvity" : "Obec";
  const toWhom = decidedByPlatform ? "správci Lonvity" : "obci";
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);

  if (status === "pending") {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-purple-dark">
        <Hourglass className="h-3.5 w-3.5" aria-hidden /> Nahlášeno, {decidedByPlatform ? "správce Lonvity" : "obec"} recenzi posuzuje
      </p>
    );
  }
  if (status === "rejected") {
    return <p className="text-xs text-muted-foreground">{decider} stížnost posoudil{decidedByPlatform ? "" : "a"} a recenzi ponechal{decidedByPlatform ? "" : "a"}.</p>;
  }
  if (!canComplain) return null;

  const length = reason.trim().length;
  const canSend = length >= REVIEW_COMPLAINT_REASON_MIN_LENGTH && length <= REVIEW_COMPLAINT_REASON_MAX_LENGTH;

  const handleOpenChange = (next: boolean) => {
    if (sending) return;
    if (!next) setReason("");
    setOpen(next);
  };

  const send = async () => {
    setSending(true);
    try {
      await reportReview(type, reviewId, reason);
      toast.success(`Recenze nahlášena. ${decider} ji posoudí a dá vám vědět.`);
      setOpen(false);
      setReason("");
      onReported();
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status < 500 ? error.message : "Recenzi se nepodařilo nahlásit.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 h-8 gap-1.5 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        <Flag className="h-3.5 w-3.5" /> Nahlásit {toWhom}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nahlásit recenzi {toWhom}</DialogTitle>
            <DialogDescription>
              {decidedByPlatform
                ? "Akci pořádá obec, a tak o stížnosti rozhoduje správce Lonvity. Posoudí, jestli recenzi odstraní."
                : "Obec posoudí, jestli recenzi odstraní."} Když ano, přestane se počítat do hodnocení. Autor recenze se o
              nahlášení nedozví.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor={`report-${reviewId}`}>Co je na recenzi špatně?</Label>
            <Textarea
              id={`report-${reviewId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={REVIEW_COMPLAINT_REASON_MAX_LENGTH}
              rows={4}
              placeholder="Např. recenze je z akce, na které autor vůbec nebyl, nebo je urážlivá…"
            />
            <p className="text-xs text-muted-foreground">
              {length < REVIEW_COMPLAINT_REASON_MIN_LENGTH
                ? `Napište aspoň ${REVIEW_COMPLAINT_REASON_MIN_LENGTH} znaků.`
                : `${reason.length}/${REVIEW_COMPLAINT_REASON_MAX_LENGTH}`}
            </p>
          </div>

          <DialogFooter className="gap-2 sm:flex-col sm:space-x-0">
            <Button className="w-full h-11" onClick={send} disabled={sending || !canSend}>
              {sending ? "Odesílám…" : `Nahlásit ${toWhom}`}
            </Button>
            <Button
              variant="ghost"
              className="w-full h-11 text-muted-foreground"
              onClick={() => handleOpenChange(false)}
              disabled={sending}
            >
              Zpět
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
