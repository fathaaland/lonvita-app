"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Clock, Landmark, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  decideEventDeletion,
  escalateEventDeletion,
  EventDeletionDecision,
  EventDeletionRequestRow,
  getFullNamesByUserIds,
  getLatestEventDeletionRequest,
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
  /** The event's pořadatel — if they're the one asking, letting them go hands the event over. */
  organizerId?: string | null;
  /** The obec co-organizes the event, so it has to consent as well. */
  obecCoOrganizes?: boolean;
  /** The viewer is an admin of the obec co-organizing the event — they only answer requests for it
   * (they cancel the event outright otherwise, with CancelEventButton). */
  forObec?: boolean;
  /** Who organizes the event has changed (the requester left it) — reload it. */
  onOrganizersChanged?: () => void;
}

type Confirm = Exclude<EventDeletionDecision, "reject"> | "escalate";

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof PayloadApiError && error.status < 500 ? error.message : fallback;

/** Deleting an event run by several organizers, or together with the obec
 * (Events.deletionNeedsConsent) — one asks, the others (and the obec) get 24 hours to consent,
 * refuse, or keep the event and let the requester go (EventDeletionRequests). After a refusal the
 * requester may ask the obec to take them off it. Takes the place of CancelEventButton for them. */
export function EventDeletionConsent({
  eventId,
  title,
  dateTime,
  userId,
  organizerId = null,
  obecCoOrganizes = false,
  forObec = false,
  onOrganizersChanged,
}: Props) {
  const router = useRouter();
  const [request, setRequest] = useState<EventDeletionRequestRow | null>(null);
  const [requesterName, setRequesterName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [asking, setAsking] = useState(false);

  const load = async () => {
    const r = await getLatestEventDeletionRequest(eventId).catch(() => null);
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
  const pending = request?.status === "pending" ? request : null;
  if (forObec && (!pending?.municipality_consent || !canCancelEvent(dateTime))) return null;

  const isRequester = request?.requested_by_id === userId;
  const requesterIsOrganizer = Boolean(request && organizerId && request.requested_by_id === organizerId);
  const requester = requesterName ?? "Spolupořadatel";
  const started = new Date(dateTime).getTime() <= Date.now();

  const handleRequest = async (e: React.MouseEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await requestEventDeletion(eventId);
      toast.success(`Žádost odeslána. ${obecCoOrganizes ? "Obec a spolupořadatelé mají" : "Spolupořadatelé mají"} 24 hodin na odpověď.`);
      setAsking(false);
      await load();
    } catch (error) {
      toast.error(errorMessage(error, "Žádost se nepodařilo odeslat."));
    } finally {
      setBusy(false);
    }
  };

  const handleDecision = async (decision: EventDeletionDecision) => {
    if (!request) return;
    setBusy(true);
    try {
      const { status } = await decideEventDeletion(request.id, decision);
      if (status === "approved") {
        toast.success("Akce smazána. Přihlášení účastníci dostanou upozornění.");
        router.push("/organizace");
        return;
      }
      if (status === "requester-removed") {
        toast.success(requesterIsOrganizer ? "Akci teď vedete vy." : `${requester} akci už nepořádá — akce zůstává.`);
        setConfirm(null);
        onOrganizersChanged?.();
        await load();
        return;
      }
      toast.success(status === "rejected" ? "Akce zůstává." : "Souhlas uložen, čeká se na ostatní.");
      setConfirm(null);
      await load();
    } catch (error) {
      toast.error(errorMessage(error, "Rozhodnutí se nepodařilo uložit."));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleEscalate = async () => {
    if (!request) return;
    setBusy(true);
    try {
      await escalateEventDeletion(request.id);
      toast.success("Žádost odeslána obci.");
      setConfirm(null);
      await load();
    } catch (error) {
      toast.error(errorMessage(error, "Žádost se nepodařilo odeslat."));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const confirmDialog = (
    <AlertDialog open={confirm !== null} onOpenChange={(next) => !busy && !next && setConfirm(null)}>
      <AlertDialogContent>
        {confirm === "approve" && (
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat akci „{title}“?</AlertDialogTitle>
            <AlertDialogDescription>
              Akce se nenávratně smaže i s přihláškami a přihlášení účastníci dostanou upozornění e-mailem, SMS a v
              aplikaci. Nejde to vrátit zpět.
            </AlertDialogDescription>
          </AlertDialogHeader>
        )}
        {confirm === "remove-requester" && (
          <AlertDialogHeader>
            <AlertDialogTitle>{requesterIsOrganizer ? `Převzít akci „${title}“?` : `Odebrat ${requester} z akce?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {requesterIsOrganizer
                ? `${requester} akci opustí a vy se stanete jejím hlavním pořadatelem — i s dobrovolnictvím a hodnocením dobrovolníků.`
                : `${requester} přestane akci pořádat a vy ji pořádáte dál.`}{" "}
              Akce zůstane, jak je, a přihlášení účastníci o změně zprávu nedostanou.
            </AlertDialogDescription>
          </AlertDialogHeader>
        )}
        {confirm === "escalate" && (
          <AlertDialogHeader>
            <AlertDialogTitle>Požádat obec o zrušení spolupořadatelství?</AlertDialogTitle>
            <AlertDialogDescription>
              Obec může rozhodnout, že akci přestanete pořádat, i bez souhlasu spolupořadatele
              {requesterIsOrganizer ? " — akce pak přejde na něj" : ""}. Rozhodnout může nejpozději do začátku akce.
            </AlertDialogDescription>
          </AlertDialogHeader>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Zpět</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              if (confirm === "escalate") handleEscalate();
              else if (confirm) handleDecision(confirm);
            }}
            disabled={busy}
            className={confirm === "approve" ? buttonVariants({ variant: "destructive" }) : undefined}
          >
            {confirm === "approve"
              ? busy ? "Mažu…" : "Smazat akci"
              : confirm === "remove-requester"
                ? busy ? "Ukládám…" : requesterIsOrganizer ? "Převzít akci" : "Odebrat žadatele"
                : busy ? "Odesílám…" : "Požádat obec"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (request?.status === "escalated") {
    return (
      <p className="text-sm text-muted-foreground flex items-start gap-1.5">
        <Landmark className="h-4 w-4 mt-0.5 shrink-0" />
        {isRequester
          ? `Požádali jste obec o zrušení spolupořadatelství. Rozhodne nejpozději do začátku akce (${formatEventDateTime(request.expires_at)}).`
          : `${requester} požádal(a) obec, aby ho z akce odebrala. Rozhodne obec.`}
      </p>
    );
  }

  if (pending) {
    const until = formatEventDateTime(pending.expires_at);
    const mustDecide = forObec
      ? !pending.municipality_approved
      : pending.approver_ids.includes(userId) && !pending.approved_by_ids.includes(userId);
    const waitingFor = pending.municipality_consent ? "spolupořadatelů a obce" : "spolupořadatelů";

    if (!mustDecide) {
      return (
        <p className="text-sm text-muted-foreground flex items-start gap-1.5">
          <Clock className="h-4 w-4 mt-0.5 shrink-0" />
          {forObec
            ? `Za obec jste se smazáním souhlasili, čeká se na spolupořadatele (do ${until}).`
            : isRequester
              ? `Žádost o smazání čeká na souhlas ${waitingFor} — nejpozději do ${until}. Když neodpoví, akce zůstane.`
              : `Se smazáním jste souhlasili, čeká se na ostatní (do ${until}).`}
        </p>
      );
    }

    return (
      <div className="space-y-3">
        <p className="text-sm">
          <strong>{requester}</strong> žádá o smazání akce.{" "}
          {forObec ? "Obec ji spolupořádá, bez jejího souhlasu se nesmaže" : "Bez vašeho souhlasu se nesmaže"} —
          odpovězte do {until}.
          {!forObec && (requesterIsOrganizer
            ? " Akci můžete také převzít — žadatel ji opustí a vy se stanete hlavním pořadatelem."
            : " Akci si také můžete ponechat a žadatele z ní odebrat.")}
        </p>
        <div className="grid gap-2">
          {!forObec && (
            <Button variant="outline" className="h-11" disabled={busy} onClick={() => setConfirm("remove-requester")}>
              {requesterIsOrganizer ? "Převzít akci, žadatel odejde" : "Ponechat akci, žadatele odebrat"}
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-11" disabled={busy} onClick={() => handleDecision("reject")}>
              Nesouhlasím
            </Button>
            <Button variant="destructive" className="flex-1 h-11" disabled={busy} onClick={() => setConfirm("approve")}>
              Souhlasím se smazáním
            </Button>
          </div>
        </div>
        {confirmDialog}
      </div>
    );
  }

  // Nothing open — the requester of a refused request may turn to the obec.
  const canEscalate = isRequester && request?.status === "rejected" && Boolean(request.rejected_by_id) && !started;
  const outcome =
    isRequester && request?.status === "escalation-rejected"
      ? "Obec vaší žádosti o zrušení spolupořadatelství nevyhověla — akci pořádáte dál."
      : null;

  return (
    <div className="space-y-3">
      {canEscalate && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Spolupořadatel nesouhlasil se smazáním akce ani s tím, abyste ji opustili. Pokud ji pořádat nechcete, může
            o tom rozhodnout obec.
          </p>
          <Button variant="outline" className="w-full h-12 text-base" disabled={busy} onClick={() => setConfirm("escalate")}>
            <Landmark className="h-4 w-4" /> Požádat obec o zrušení spolupořadatelství
          </Button>
        </div>
      )}
      {outcome && <p className="text-sm text-muted-foreground">{outcome}</p>}
      {canCancelEvent(dateTime) ? (
        <AlertDialog open={asking} onOpenChange={(next) => !busy && setAsking(next)}>
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
                Akci pořádáte {obecCoOrganizes ? "s obcí" : "se spolupořadateli"}, takže se smaže jen s{" "}
                {obecCoOrganizes ? "souhlasem obce (a případných dalších spolupořadatelů)" : "jejich souhlasem"}. Dostanou
                upozornění a mají 24 hodin na odpověď. Když souhlasí, akce se nenávratně smaže a přihlášení dostanou
                upozornění. Spolupořadatel si také může akci ponechat — vy ji pak opustíte. Když nesouhlasí nebo
                neodpoví, akce zůstane.
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
      ) : (
        <div className="space-y-1.5">
          <Button variant="outline" disabled className="w-full h-12 text-base">
            <Ban className="h-4 w-4" /> Akci už nelze smazat
          </Button>
          <p className="text-sm text-muted-foreground text-center">
            Smazat akci jde nejpozději {EVENT_CANCELLATION_CUTOFF_HOURS} hodiny před jejím začátkem.
          </p>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
