"use client";

import { useEffect, useState } from "react";
import { HandHeart, Users } from "lucide-react";
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
import { cn } from "@/lib/utils";

type Choice = "participant" | "volunteer";

/**
 * "Přihlásit se" for someone from the volunteer pool on an event that looks for volunteers — they
 * either come as a participant, or offer to help; the event's creator accepts or declines the offer
 * (VolunteerInvitations, kind "application"). A volunteer takes no participant's place, so helping
 * stays open on a full event.
 */
export function JoinEventDialog({
  open,
  onOpenChange,
  full,
  needsApproval,
  lastOfferDeclined,
  busy,
  onJoin,
  onOffer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** No participant places left. */
  full: boolean;
  /** Participants are approved by the organizer (registrationApprovalMode "manual"). */
  needsApproval: boolean;
  lastOfferDeclined: boolean;
  busy: boolean;
  onJoin: () => void;
  onOffer: (message: string) => void;
}) {
  const [choice, setChoice] = useState<Choice>(full ? "volunteer" : "participant");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setChoice(full ? "volunteer" : "participant");
    setMessage("");
  }, [open, full]);

  const options: { value: Choice; icon: typeof Users; title: string; text: string; disabled?: boolean }[] = [
    {
      value: "participant",
      icon: Users,
      title: "Jako účastník",
      text: full
        ? "Akce je plná — jako účastník se už přihlásit nejde."
        : needsApproval
          ? "Přijdete na akci. Přihlášku schvaluje pořadatel."
          : "Přijdete na akci. Přihlášení jste hned.",
      disabled: full,
    },
    {
      value: "volunteer",
      icon: HandHeart,
      title: "Jako dobrovolník",
      text: "Pomůžete akci připravit nebo vést a nezaberete místo účastníkům. Pořadatel vaši nabídku přijme, nebo odmítne.",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Jak se chcete přihlásit?</DialogTitle>
          <DialogDescription>Pořadatel na tuhle akci hledá i dobrovolníky.</DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Způsob přihlášení" className="space-y-2">
          {options.map(({ value, icon: Icon, title, text, disabled }) => {
            const selected = choice === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => setChoice(value)}
                className={cn(
                  "w-full flex items-start gap-3 rounded-xl border-[1.5px] p-4 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "border-primary bg-brand-purple-pale" : "border-border bg-card hover:border-brand-purple",
                  disabled && "opacity-60 cursor-not-allowed hover:border-border",
                )}
              >
                <Icon className={cn("h-5 w-5 mt-0.5 shrink-0", selected ? "text-primary" : "text-muted-foreground")} aria-hidden />
                <span className="space-y-0.5">
                  <span className="block font-bold">{title}</span>
                  <span className="block text-sm text-muted-foreground">{text}</span>
                </span>
              </button>
            );
          })}
        </div>

        {choice === "volunteer" && (
          <div className="space-y-2">
            {lastOfferDeclined && (
              <p className="text-sm text-muted-foreground">Vaši minulou nabídku pořadatel nepřijal — můžete ji poslat znovu.</p>
            )}
            <Label htmlFor="offer-message">S čím můžete pomoct (nepovinné)</Label>
            <Textarea
              id="offer-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Např. můžu odvézt dva lidi autem nebo pomoct s přípravou sálu."
              maxLength={500}
              rows={3}
            />
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Zrušit
          </Button>
          <Button
            onClick={() => (choice === "volunteer" ? onOffer(message) : onJoin())}
            disabled={busy || (choice === "participant" && full)}
          >
            {busy ? "Odesílám…" : choice === "volunteer" ? "Nabídnout pomoc" : "Přihlásit se"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
