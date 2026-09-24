"use client";

import { useEffect, useState } from "react";
import {
  getMyRegistrationsWithEvents,
  getMyFeedbackForRegistrations,
  submitEventFeedback,
  RegistrationWithEventRow,
} from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquareHeart, Star } from "lucide-react";
import { toast } from "sonner";
import { PayloadApiError } from "@/integrations/payload/client";

function StarPicker({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${n} z 5`}
            className="h-9 w-9 flex items-center justify-center"
          >
            <Star className={n <= value ? "h-6 w-6 fill-[hsl(var(--warning))] text-[hsl(var(--warning))]" : "h-6 w-6 text-muted-foreground"} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** The one thing both entry points need to know about what's being rated. */
export type FeedbackTarget = { registrationId: string; title: string };

/** US-U-03 rating form — shared by the profile's "Jak se vám líbilo?" card and the "Ohodnotit"
 * button on past events in Moje akce. `onSubmitted` fires once the feedback is saved. */
export function EventFeedbackDialog({
  target,
  onClose,
  onSubmitted,
}: {
  target: FeedbackTarget | null;
  onClose: () => void;
  onSubmitted: (registrationId: string, satisfaction: number) => void;
}) {
  const [satisfaction, setSatisfaction] = useState(0);
  const [feltWelcome, setFeltWelcome] = useState(0);
  const [metSomeoneNew, setMetSomeoneNew] = useState(false);
  const [cameAlone, setCameAlone] = useState(false);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  // A fresh form for every event opened, not the previous one's answers.
  useEffect(() => {
    if (!target) return;
    setSatisfaction(0);
    setFeltWelcome(0);
    setMetSomeoneNew(false);
    setCameAlone(false);
    setComment("");
  }, [target?.registrationId]);

  const submit = async () => {
    if (!target) return;
    if (satisfaction < 1) {
      toast.error("Ohodnoťte prosím spokojenost.");
      return;
    }
    setSaving(true);
    try {
      await submitEventFeedback({
        registrationId: target.registrationId,
        satisfactionRating: satisfaction,
        feltWelcomeRating: feltWelcome || undefined,
        metSomeoneNew,
        cameAlone,
        comment: comment.trim() || undefined,
      });
      toast.success("Děkujeme za zpětnou vazbu!");
      onSubmitted(target.registrationId, satisfaction);
    } catch (error) {
      // The server's own reason when it has one (e.g. attendance not confirmed yet).
      toast.error(
        error instanceof PayloadApiError && error.status < 500 ? error.message : "Nepodařilo se odeslat zpětnou vazbu.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{target?.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <StarPicker value={satisfaction} onChange={setSatisfaction} label="Celková spokojenost" />
          <StarPicker value={feltWelcome} onChange={setFeltWelcome} label="Cítili jste se vítáni? (nepovinné)" />

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="met-someone">Potkali jste někoho nového?</Label>
            <Switch id="met-someone" checked={metSomeoneNew} onCheckedChange={setMetSomeoneNew} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="came-alone">Přišli jste sami?</Label>
            <Switch id="came-alone" checked={cameAlone} onCheckedChange={setCameAlone} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fb-comment">Komentář pro pořadatele (nepovinné)</Label>
            <Textarea
              id="fb-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={500}
              rows={3}
            />
          </div>

          <Button onClick={submit} disabled={saving} className="w-full h-11">
            {saving ? "Odesílám…" : "Odeslat hodnocení"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** US-U-03 — after an event the organizer marked this user as "attended" for, prompt for feedback
 * (EventFeedback collection). Only shows events with nothing submitted yet. */
export function EventFeedbackCard() {
  const { user } = useAuth();
  const [pending, setPending] = useState<RegistrationWithEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<FeedbackTarget | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const regs = await getMyRegistrationsWithEvents(String(user.id));
        const attended = regs.filter((r) => r.status === "approved" && r.attendance_status === "attended" && r.events);
        const feedback = await getMyFeedbackForRegistrations(attended.map((r) => r.id));
        setPending(attended.filter((r) => !feedback.has(r.id)));
      } catch {
        // Just a prompt — if it can't load, the profile shows without it.
        setPending([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.id]);

  if (loading || pending.length === 0) return null;

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MessageSquareHeart className="h-5 w-5 text-[hsl(var(--brand-purple))]" />
            <p className="font-bold">Jak se vám líbilo?</p>
          </div>
          <div className="space-y-2">
            {pending.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold truncate">{r.events?.title}</p>
                <Button size="sm" variant="outline" onClick={() => setOpen({ registrationId: r.id, title: r.events?.title ?? "" })}>
                  Ohodnotit
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <EventFeedbackDialog
        target={open}
        onClose={() => setOpen(null)}
        onSubmitted={(registrationId) => {
          setPending((prev) => prev.filter((r) => r.id !== registrationId));
          setOpen(null);
        }}
      />
    </>
  );
}
