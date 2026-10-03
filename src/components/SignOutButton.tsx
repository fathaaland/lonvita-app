"use client";

import { ReactNode } from "react";
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

/** Every "Odhlásit" in the app — asks first, so a stray tap doesn't sign anyone out. `children` is
 * the button that opens the question. */
export function SignOutButton({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Odhlásit se?</AlertDialogTitle>
          <AlertDialogDescription>Pro další použití Lonvity se budete muset znovu přihlásit.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Zůstat přihlášen/a</AlertDialogCancel>
          <AlertDialogAction onClick={signOut}>Odhlásit se</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
