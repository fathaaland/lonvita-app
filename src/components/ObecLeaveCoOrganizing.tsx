"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { leaveCoOrganizing, leaveCoOrganizingAsObec } from "@/integrations/payload/queries";
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
  /** A neighbouring obec from the mikroregion co-organizing the event — it may be invited again. */
  neighbour?: boolean;
  /** A spolupořadatel's organization leaving on its own (in a mikroregion) — not the obec. */
  organization?: boolean;
}

/** "Ukončit spolupořádání" for the obec's admin — the obec steps off an event it co-organizes,
 * without anyone's consent (the obec-leave route). The event's own obec can never come back to it;
 * a neighbouring obec may be invited again. */
export function ObecLeaveCoOrganizing({ eventId, title, onLeft, neighbour = false, organization = false }: Props) {
  const who = organization ? "Vaše organizace" : "Obec";
  const mayReturn = neighbour || organization;
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const handleConfirm = async (e: React.MouseEvent) => {
    // Keep the dialog open (with its buttons disabled) until the request has finished.
    e.preventDefault();
    setLeaving(true);
    try {
      await (organization ? leaveCoOrganizing(eventId) : leaveCoOrganizingAsObec(eventId));
      toast.success(`${who} akci už nespolupořádá. Pořadatelé dostali zprávu.`);
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
        <h2 className="text-lg font-bold">{organization ? "Spolupořádání" : "Spolupořádání obce"}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {mayReturn
            ? `${who} může spolupořádání ukončit sama, bez souhlasu pořadatele i obce. Akce zůstane ostatním a pořadatel vás může později pozvat znovu.`
            : "Obec může spolupořádání ukončit sama, bez souhlasu pořadatele. Vrátit se k akci už pak nepůjde."}
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
              {who} přestane akci spolupořádat a akce zůstane pořadateli a ostatním spolupořadatelům — dostanou o tom
              zprávu.{" "}
              {mayReturn
                ? "Spolupořadatelem se můžete stát znovu, jen když vás pořadatel pozve a vy pozvánku přijmete."
                : "Tohle nejde vrátit zpět: obec se k akci už nikdy nepřidá, ani na novou pozvánku."}
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
