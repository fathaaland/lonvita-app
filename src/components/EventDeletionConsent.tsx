"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Clock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  decideEventDeletion,
  EventDeletionRequestRow,
  getFullNamesByUserIds,
  getOpenEventDeletionRequest,
  requestEventDeletion,
} from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatEventDateTime } from "@/lib/date";
import { canCancelEvent, EVENT_CANCELLATION_CUTOFF_HOURS } from "@/lib/eventCancellation";

interface Props {
  eventId: string;
  title: string;
  dateTime: string;
  userId: string;
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof PayloadApiError && error.status < 500 ? error.message : fallback;

/** Deleting an event run by several organizers (Events.deletionNeedsConsent) — one asks, the others
 * get 24 hours to consent (EventDeletionRequests). Takes the place of CancelEventButton for them. */
export function EventDeletionConsent({ eventId, title, dateTime, userId }: Props) {
  const router = useRouter();
  const [request, setRequest] = useState<EventDeletionRequestRow | null>(null);
  const [requesterName, setRequesterName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const r = await getOpenEventDeletionRequest(eventId).catch(() => null);
    setRequest(r);
    if (r) {
      const names = await getFullNamesByUserIds([r.requested_by_id]).catch(() => new Map<string, string>());
      setRequesterName(names.get(r.requested_by_id) ?? null);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  if (loading) return null;

  if (!canCancelEvent(dateTime)) {
    return (
      <div className="space-y-1.5">
        <Button variant="outline" disabled className="w-full h-12 text-base">
          <Ban className="h-4 w-4" /> Akci už nelze smazat
        </Button>
        <p className="text-sm text-muted-foreground text-center">
          Smazat akci jde nejpozději {EVENT_CANCELLATION_CUTOFF_HOURS} hodiny před jejím začátkem.
        </p>
      </div>
    );
  }

  const handleRequest = async (e: React.MouseEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await requestEventDeletion(eventId);
      toast.success("Žádost odeslána. Spolupořadatelé mají 24 hodin na odpověď.");
      setOpen(false);
      await load();
    } catch (error) {
      toast.error(errorMessage(error, "Žádost se nepodařilo odeslat."));
    } finally {
      setBusy(false);
    }
  };

  const handleDecision = async (approve: boolean) => {
    if (!request) return;
    setBusy(true);
    try {
      const { status } = await decideEventDeletion(request.id, approve);
      if (status === "approved") {
        toast.success("Akce smazána. Přihlášení účastníci dostanou upozornění.");
        router.push("/organizator");
        return;
      }
      toast.success(status === "rejected" ? "Akce zůstává." : "Souhlas uložen, čeká se na ostatní spolupořadatele.");
      setOpen(false);
      await load();
    } catch (error) {
      toast.error(errorMessage(error, "Rozhodnutí se nepodařilo uložit."));
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!request) {
    return (
      <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            className="w-full h-12 text-base text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" /> Požádat o smazání akce
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Požádat o smazání „{title}“?</AlertDialogTitle>
            <AlertDialogDescription>
              Akci pořádáte se spolupořadateli, takže se smaže jen s jejich souhlasem. Dostanou upozornění a mají 24
              hodin na odpověď. Když souhlasí, akce se nenávratně smaže a přihlášení dostanou upozornění. Když
              nesouhlasí nebo neodpoví, akce zůstane.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Zpět</AlertDialogCancel>
            <AlertDialogAction onClick={handleRequest} disabled={busy} className={buttonVariants({ variant: "destructive" })}>
              {busy ? "Odesílám…" : "Odeslat žádost"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  const until = formatEventDateTime(request.expires_at);
  const mustDecide = request.approver_ids.includes(userId) && !request.approved_by_ids.includes(userId);

  if (!mustDecide) {
    return (
      <p className="text-sm text-muted-foreground flex items-start gap-1.5">
        <Clock className="h-4 w-4 mt-0.5 shrink-0" />
        {request.requested_by_id === userId
          ? `Žádost o smazání čeká na souhlas spolupořadatelů — nejpozději do ${until}. Když neodpoví, akce zůstane.`
          : `Se smazáním jste souhlasili, čeká se na ostatní spolupořadatele (do ${until}).`}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        <strong>{requesterName ?? "Spolupořadatel"}</strong> žádá o smazání akce. Bez vašeho souhlasu se nesmaže —
        odpovězte do {until}.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1 h-11" disabled={busy} onClick={() => handleDecision(false)}>
          Nesouhlasím
        </Button>
        <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="flex-1 h-11" disabled={busy}>
              Souhlasím se smazáním
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Smazat akci „{title}“?</AlertDialogTitle>
              <AlertDialogDescription>
                Akce se nenávratně smaže i s přihláškami a přihlášení účastníci dostanou upozornění e-mailem, SMS a v
                aplikaci. Nejde to vrátit zpět.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Zpět</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleDecision(true);
                }}
                disabled={busy}
                className={buttonVariants({ variant: "destructive" })}
              >
                {busy ? "Mažu…" : "Smazat akci"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
