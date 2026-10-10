"use client";

import { useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PayloadApiError } from "@/integrations/payload/client";
import { deleteMyAccount, getAccountDeletionBlockers, type AccountDeletionBlockers } from "@/integrations/payload/queries";
import { ACCOUNT_DELETION_CONFIRMATION } from "@/lib/accountDeletion";
import { formatEventDateTime } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * "Smazat účet" — the person goes, what they took part in stays, anonymized, in the obec's and the
 * organizers' overviews (shared/anonymizeUser). An organizer still running an event ahead is shown
 * which ones, and an obec's only admin which obec, instead of the button. Typing the confirmation word guards against a stray tap.
 */
export function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const [blockers, setBlockers] = useState<AccountDeletionBlockers | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  const openDialog = async () => {
    setConfirmation("");
    setBlockers(null);
    setOpen(true);
    setBlockers(await getAccountDeletionBlockers().catch(() => ({ blockingEvents: [], soleAdminOf: [] })));
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await deleteMyAccount();
      // A full reload: the session cookie is gone, and nothing of the signed-in state may linger.
      window.location.assign("/?ucet-smazan=1");
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Účet se nepodařilo smazat.");
      setBusy(false);
    }
  };

  const blocked = blockers !== null && (blockers.blockingEvents.length > 0 || blockers.soleAdminOf.length > 0);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div>
          <p className="font-bold">Smazat účet</p>
          <p className="text-sm text-muted-foreground">
            Vaše jméno, kontakty a fotka se smažou. To, čeho jste se účastnili, zůstane obci jen jako anonymní statistika.
          </p>
        </div>
        <Button onClick={openDialog} variant="outline" className="w-full h-12 text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" /> Smazat účet
        </Button>
      </CardContent>

      <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{blocked ? "Účet zatím smazat nejde" : "Opravdu smazat účet?"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              {blocked ? (
                <div className="space-y-2">
                  {blockers.soleAdminOf.length > 0 && (
                    <p>
                      Jste jediný admin obce {blockers.soleAdminOf.map((m) => m.name).join(", ")} — bez vás by žádosti
                      o roli pořadatele ani stížnosti neměl kdo vyřídit. Napište správci Lonvity, ať obci určí dalšího
                      admina; potom účet smazat půjde.
                    </p>
                  )}
                  {blockers.blockingEvents.length > 0 && (
                    <p>Pořádáte akce, které ještě neproběhly. Zrušte je, nebo z nich odejděte přes žádost o smazání:</p>
                  )}
                  <ul className="space-y-1">
                    {blockers.blockingEvents.map((event) => (
                      <li key={event.id}>
                        <Link href={`/akce/${event.id}`} className="font-semibold text-primary underline">
                          {event.title}
                        </Link>{" "}
                        · {formatEventDateTime(event.date_time)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="space-y-2">
                  <p>
                    Smaže se vaše jméno, e-mail, telefon, fotka, datum narození i to, co jste napsali (komentáře,
                    omluvenky). Z akcí, které vás teprve čekají, se odhlásíte. Přihlásit se k účtu už nepůjde.
                  </p>
                  <p>
                    Účast na proběhlých akcích a vaše hodnocení (hvězdičky) zůstanou obci a pořadatelům jako anonymní
                    statistika — nikdo už nepozná, že jste to byli vy.
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {blockers !== null && !blocked && (
            <div className="space-y-1.5">
              <Label htmlFor="delete-account-confirm">Pro potvrzení napište {ACCOUNT_DELETION_CONFIRMATION}</Label>
              <Input
                id="delete-account-confirm"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
                className="h-12"
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{blocked ? "Zavřít" : "Ponechat účet"}</AlertDialogCancel>
            {!blocked && (
              <Button
                onClick={confirm}
                disabled={busy || confirmation.trim().toUpperCase() !== ACCOUNT_DELETION_CONFIRMATION}
                variant="destructive"
              >
                {busy ? "Mažu…" : "Smazat účet"}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
