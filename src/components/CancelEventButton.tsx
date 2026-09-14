"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteEvent } from "@/integrations/payload/admin-queries";
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
}

/** "Zrušit akci" with a confirmation dialog. The cut-off is enforced server-side as well
 * (Events' guardCancellationWindow hook); this only decides whether to offer the action. */
export function CancelEventButton({ eventId, title, dateTime, variant = "button", onCancelled }: Props) {
  const router = useRouter();
  const { isSuperAdmin, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

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
    <AlertDialog open={open} onOpenChange={(next) => !cancelling && setOpen(next)}>
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
            Všichni přihlášení účastníci dostanou upozornění e-mailem, SMS a v aplikaci a akce zmizí z přehledu.
            Zrušení nejde vrátit zpět.
          </AlertDialogDescription>
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
