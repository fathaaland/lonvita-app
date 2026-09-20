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

/** US-U-03 — after an event the organizer marked this user as "attended" for, prompt for feedback
 * (EventFeedback collection). Only shows events with nothing submitted yet. */
export function EventFeedbackCard() {
  const { user } = useAuth();
  const [pending, setPending] = useState<RegistrationWithEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<RegistrationWithEventRow | null>(null);
  const [satisfaction, setSatisfaction] = useState(0);
  const [feltWelcome, setFeltWelcome] = useState(0);
  const [metSomeoneNew, setMetSomeoneNew] = useState(false);
  const [cameAlone, setCameAlone] = useState(false);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const regs = await getMyRegistrationsWithEvents(String(user.id));
      const attended = regs.filter((r) => r.attendance_status === "attended" && r.events);
      const feedback = await getMyFeedbackForRegistrations(attended.map((r) => r.id));
      setPending(attended.filter((r) => !feedback.has(r.id)));
      setLoading(false);
    })();
  }, [user?.id]);

  const openDialog = (reg: RegistrationWithEventRow) => {
    setOpen(reg);
    setSatisfaction(0);
    setFeltWelcome(0);
    setMetSomeoneNew(false);
    setCameAlone(false);
    setComment("");
  };

  const submit = async () => {
    if (!open) return;
    if (satisfaction < 1) {
      toast.error("Ohodnoťte prosím spokojenost.");
      return;
    }
    setSaving(true);
    try {
      await submitEventFeedback({
        registrationId: open.id,
        satisfactionRating: satisfaction,
        feltWelcomeRating: feltWelcome || undefined,
        metSomeoneNew,
        cameAlone,
        comment: comment.trim() || undefined,
      });
      toast.success("Děkujeme za zpětnou vazbu!");
      setPending((prev) => prev.filter((r) => r.id !== open.id));
      setOpen(null);
    } catch {
      toast.error("Nepodařilo se odeslat zpětnou vazbu.");
    } finally {
      setSaving(false);
    }
  };

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
                <Button size="sm" variant="outline" onClick={() => openDialog(r)}>
                  Ohodnotit
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{open?.events?.title}</DialogTitle>
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
              <Label htmlFor="fb-comment">Komentář (nepovinné)</Label>
              <Textarea
                id="fb-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={500}
                rows={3}
              />
            </div>

            <Button onClick={submit} disabled={saving} className="w-full h-11">
              {saving ? "Odesílám…" : "Odeslat"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
