"use client";

import type { ComponentProps, ReactNode } from "react";

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

interface Props extends Omit<ComponentProps<typeof Button>, "onClick" | "title"> {
  /** The question the dialog asks, e.g. "Schválit žádost Jana Nováka?". */
  title: string;
  /** What happens once confirmed — said before anything is written. */
  description: ReactNode;
  confirmLabel: string;
  /** Runs only after the confirmation; the caller keeps its own busy state and toasts. */
  onConfirm: () => unknown;
  /** Paints the confirming button red — for taking something away (reject, revoke, withdraw). */
  destructive?: boolean;
}

/**
 * A decision that can't be taken back — approving or rejecting a request, withdrawing an invitation,
 * revoking a role — asks first and writes nothing until confirmed. The trigger is an ordinary
 * Button (all its props pass through); the same AlertDialog pattern ConfirmDeleteButton uses.
 */
export function ConfirmActionButton({
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
  children,
  ...buttonProps
}: Props) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button {...buttonProps}>{children}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Zpět</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => void onConfirm()}
            className={destructive ? buttonVariants({ variant: "destructive" }) : undefined}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
