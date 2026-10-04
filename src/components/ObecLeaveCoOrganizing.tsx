"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { leaveCoOrganizingAsObec } from "@/integrations/payload/queries";
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

interface Props {
  eventId: string;
  title: string;
  /** Runs once the obec is off the event. */
  onLeft: () => void;
}

/** "Ukončit spolupořádání" for the obec's admin — the obec steps off an event it co-organizes,
 * without anyone's consent, and can never come back to it (the obec-leave route). */
export function ObecLeaveCoOrganizing({ eventId, title, onLeft }: Props) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const handleConfirm = async (e: React.MouseEvent) => {
    // Keep the dialog open (with its buttons disabled) until the request has finished.
    e.preventDefault();
    setLeaving(true);
    try {
      await leaveCoOrganizingAsObec(eventId);
      toast.success("Obec akci už nespolupořádá. Pořadatelé dostali zprávu.");
      setOpen(false);
      onLeft();
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status < 500 ? error.message : "Spolupořádání se nepodařilo ukončit.",
      );
    } finally {
      setLeaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border p-4 space-y-3">
      <div>
        <h2 className="text-lg font-bold">Spolupořádání obce</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Obec může spolupořádání ukončit sama, bez souhlasu pořadatele. Vrátit se k akci už pak nepůjde.
        </p>
      </div>
      <AlertDialog open={open} onOpenChange={(next) => !leaving && setOpen(next)}>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            className="w-full h-12 text-base text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-4 w-4" /> Ukončit spolupořádání
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ukončit spolupořádání akce „{title}“?</AlertDialogTitle>
            <AlertDialogDescription>
              Obec přestane akci spolupořádat a akce zůstane pořadateli a ostatním spolupořadatelům — dostanou o tom
              zprávu. Tohle nejde vrátit zpět: obec se k akci už nikdy nepřidá, ani na novou pozvánku.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>Zůstat spolupořadatelem</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={leaving}
              className={buttonVariants({ variant: "destructive" })}
            >
              {leaving ? "Ukončuji…" : "Ukončit spolupořádání"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
