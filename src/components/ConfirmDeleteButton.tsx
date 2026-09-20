"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { PayloadApiError } from "@/integrations/payload/client";

interface Props {
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
  errorMessage?: string;
}

/** Small confirm-then-delete trash icon — the same AlertDialog pattern CancelEventButton
 * uses, reused for the superadmin panel's obec/uživatel CRUD (§image1 "upravit a smazat"). */
export function ConfirmDeleteButton({ title, description, onConfirm, errorMessage = "Akci se nepodařilo dokončit." }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async (e: React.MouseEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch (error) {
      // A refusal the backend spelled out (e.g. "uživatel je pořadatelem 3 akcí") says what to do
      // about it — the generic fallback doesn't, so prefer the real message when there is one.
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : errorMessage);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label="Smazat"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Zrušit</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={busy} className={buttonVariants({ variant: "destructive" })}>
            {busy ? "Mažu…" : "Smazat"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
