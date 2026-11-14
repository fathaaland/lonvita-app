"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteEvent } from "@/integrations/payload/admin-queries";
import { getEventSmsPreview, type EventSmsPreview } from "@/integrations/payload/queries";
import { smsSentForCapacity } from "@/lib/capacity";
import { PayloadApiError } from "@/integrations/payload/client";
import { useAuth } from "@/contexts/AuthContext";
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
import { canCancelEvent, EVENT_CANCELLATION_CUTOFF_HOURS, eventCancellationDeadline } from "@/lib/eventCancellation";
import { cancelChannels, useMunicipalityFeatures } from "@/hooks/useMunicipalityFeatures";

interface Props {
  eventId: string;
  title: string;
  /** Event start (ISO) — cancelling closes EVENT_CANCELLATION_CUTOFF_HOURS before it. */
  dateTime: string;
  /** "button": full-width button with the deadline note (event detail). "icon": compact trash
   * icon (events table), not rendered at all once the event can no longer be cancelled. */
  variant?: "button" | "icon";
  /** Runs after a successful cancellation. Without it the viewer is taken to their own overview —
   * the cancelled event no longer exists for anyone. */
  onCancelled?: () => void;
  /** The event's obec — whether the registrants are texted too depends on its SMS service. */
  municipalityId?: string | null;
  /** SMS go out only for an event of fewer than SMS_LARGE_EVENT_CAPACITY places — the dialog says which. */
  capacity: number;
}

/** "Zrušit akci" with a confirmation dialog. The cut-off is enforced server-side as well
 * (Events' guardCancellationWindow hook); this only decides whether to offer the action. */
export function CancelEventButton({ eventId, title, dateTime, variant = "button", onCancelled, municipalityId, capacity }: Props) {
  const { sms } = useMunicipalityFeatures(municipalityId);
  const router = useRouter();
  const { isSuperAdmin, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // The answer remembers which opening of the dialog it belongs to, so an old one is never shown
  // for a new opening — the quota moves with every SMS the obec sends.
  const [answer, setAnswer] = useState<{ opening: number; preview: EventSmsPreview } | null>(null);
  const [opening, setOpening] = useState(0);

  const wantsPreview = open && sms && smsSentForCapacity(capacity);
  useEffect(() => {
    if (!wantsPreview) return;
    let active = true;
    getEventSmsPreview(eventId)
      .then((p) => active && setAnswer({ opening, preview: p }))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [wantsPreview, eventId, opening]);
  const preview = answer?.opening === opening ? answer.preview : null;

  if (!canCancelEvent(dateTime)) {
    if (variant === "icon") return null;
    return (
      <div className="space-y-1.5">
        <Button variant="outline" disabled className="w-full h-12 text-base">
          <Ban className="h-4 w-4" /> Akci už nelze zrušit
        </Button>
        <p className="text-sm text-muted-foreground text-center">
          Zrušit akci jde nejpozději {EVENT_CANCELLATION_CUTOFF_HOURS} hodiny před jejím začátkem.
        </p>
      </div>
    );
  }

  const handleConfirm = async (e: React.MouseEvent) => {
    // Keep the dialog open (with its buttons disabled) until the request has finished.
    e.preventDefault();
    setCancelling(true);
    try {
      await deleteEvent(eventId);
      toast.success("Akce zrušena. Přihlášení účastníci dostanou upozornění.");
      setOpen(false);
      if (onCancelled) onCancelled();
      else router.push(isSuperAdmin ? "/superadmin" : isAdmin ? "/admin-obce" : "/moje-akce");
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status === 400 ? error.message : "Akci se nepodařilo zrušit.",
      );
    } finally {
      setCancelling(false);
    }
  };

  const dialog = (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (cancelling) return;
        if (next) setOpening((n) => n + 1);
        setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>
        {variant === "icon" ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
            aria-label="Zrušit akci"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant="outline"
            className="w-full h-12 text-base text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          >
            <Ban className="h-4 w-4" /> Zrušit akci
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Zrušit akci „{title}“?</AlertDialogTitle>
          <AlertDialogDescription>
            Všichni přihlášení účastníci dostanou upozornění {cancelChannels(sms, capacity)} a akce zmizí z přehledu.
            Zrušení nejde vrátit zpět.
          </AlertDialogDescription>
          {preview?.sms && preview.wanted > 0 && <SmsPreviewNote preview={preview} />}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancelling}>Ponechat akci</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={cancelling}
            className={buttonVariants({ variant: "destructive" })}
          >
            {cancelling ? "Ruším…" : "Zrušit akci"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (variant === "icon") return dialog;

  return (
    <div className="space-y-1.5">
      {dialog}
      <p className="text-sm text-muted-foreground text-center">
        Zrušit lze nejpozději {EVENT_CANCELLATION_CUTOFF_HOURS} hodiny před začátkem, tedy do{" "}
        {formatEventDateTime(eventCancellationDeadline(dateTime).toISOString())}.
      </p>
    </div>
  );
}

/** Whether the registrants who chose SMS get one — and, for the obec's admins, what it does to the
 * quota. Numbers after a colon: no Czech plural to get wrong. */
function SmsPreviewNote({ preview }: { preview: Extract<EventSmsPreview, { sms: true }> }) {
  const { wanted, texted, overage, remaining } = preview;
  if (texted === 0) {
    return (
      <p className="text-sm text-destructive">
        Obec už vyčerpala roční kvótu SMS — SMS si zvolilo: {wanted}, o zrušení se ale dozvědí jen e-mailem a v
        aplikaci.
      </p>
    );
  }
  // Past the overage cap only some are texted — the others still hear it by e-mail and in the app.
  if (texted < wanted) {
    return (
      <p className="text-sm text-destructive">
        SMS o zrušení dostane jen část z těch, kdo si ji zvolili (SMS: {texted} z {wanted}) — obec dosáhne stropu
        přečerpání SMS. Ostatní se to dozvědí e-mailem a v aplikaci.
        {overage ? ` Nad roční kvótu půjde: ${overage} (vyúčtuje se jako přečerpání).` : ""}
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      SMS o zrušení dostanou všichni, kdo si ji zvolili (počet: {texted}).
      {remaining !== undefined && ` Obci zbývá SMS: ${remaining}`}
      {overage ? `, nad roční kvótu půjde: ${overage} (vyúčtuje se jako přečerpání).` : remaining !== undefined ? "." : ""}
    </p>
  );
}
