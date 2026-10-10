"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cancelRegistration } from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { OrganizerContactCard } from "@/components/OrganizerContactCard";
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
import { formatEventDateTime } from "@/lib/date";
import { isRegistrationOpen, REGISTRATION_CUTOFF_HOURS, registrationDeadline } from "@/lib/registrationCutoff";

interface Props {
  registration: { id: string; status: string; role: "participant" | "volunteer" };
  event: { id: string; date_time: string };
  onCancelled: () => void;
}

/**
 * "Zrušit přihlášku" on the event detail — until REGISTRATION_CUTOFF_HOURS before the start, like
 * signing up. A pending registration is simply withdrawn; an approved one goes with an excuse to the
 * organizer (nepovinná). After the cut-off there's no cancelling in the app any more, only the
 * organizer's contact to call or e-mail. Enforced server-side too (Registrations guardOwnCancellation)
 * — a 400 there means the window closed while the page was open.
 */
export function CancelRegistrationDialog({ registration, event, onCancelled }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [windowClosed, setWindowClosed] = useState(false);

  const volunteer = registration.role === "volunteer";
  const counted = registration.status === "approved";

  useEffect(() => {
    if (open) setMessage("");
  }, [open]);

  if (windowClosed || !isRegistrationOpen(event.date_time)) {
    return (
      <div className="space-y-2">
        <OrganizerContactCard eventId={event.id} />
        <p className="text-center text-sm text-muted-foreground">
          {/* {volunteer ? "Zrušit účast" : "Odhlásit se"} šlo nejpozději {REGISTRATION_CUTOFF_HOURS} hodiny před začátkem akce. */}
          {volunteer ? "Zrušit účast" : "Odhlásit se"} šlo jen před začátkem akce. Pokud nemůžete {volunteer ? "pomoct" : "přijít"}, zavolejte nebo napište pořadateli.
        </p>
      </div>
    );
  }

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await cancelRegistration(registration.id, counted ? message : undefined);
      toast.success(counted && message.trim() ? "Omluvenka odeslána pořadateli." : "Přihláška zrušena.");
      setOpen(false);
      onCancelled();
    } catch (error) {
      if (error instanceof PayloadApiError && error.status === 400) {
        setOpen(false);
        setWindowClosed(true);
      }
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Nepodařilo se zrušit přihlášku.");
    } finally {
      setBusy(false);
    }
  };

  const label = volunteer ? "Zrušit účast" : "Zrušit přihlášku";

  return (
    <div className="space-y-1.5">
      <Button onClick={() => setOpen(true)} variant="outline" className="w-full h-12 text-base">
        {label}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {counted ? "Omluvit se a zrušit" : "Zrušit"} {volunteer ? "účast" : "přihlášku"} můžete do{" "}
        {formatEventDateTime(registrationDeadline(event.date_time).toISOString())}.
      </p>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{counted ? "Omluvit se z akce" : "Zrušit přihlášku?"}</DialogTitle>
            <DialogDescription>
              {!counted
                ? "Vaše přihláška zatím čeká na schválení — pořadatel ji už nebude posuzovat."
                : volunteer
                  ? "Pořadatel dostane upozornění, že na akci nepomůžete — i s vaší omluvenkou."
                  : "Pořadatel dostane upozornění, že nepřijdete — i s vaší omluvenkou."}
            </DialogDescription>
          </DialogHeader>

          {counted && (
            <div className="space-y-2">
              <Label htmlFor="excuse-message">Omluvenka pro pořadatele (nepovinné)</Label>
              <Textarea
                id="excuse-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Např. nemůžu kvůli nemoci, moc se omlouvám."
                maxLength={1000}
                rows={3}
              />
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Ponechat
            </Button>
            <Button variant="destructive" onClick={handleConfirm} disabled={busy}>
              {busy ? "Ruším…" : counted ? (volunteer ? "Omluvit se a zrušit účast" : "Omluvit se a zrušit přihlášku") : label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
