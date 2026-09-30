"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getAuthMode, linkGoogleRedirect } from "@/integrations/payload/client";
import { getMyLinkedAccounts, unlinkAccount, LinkedAccountRow } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
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
import { GoogleIcon } from "@/components/GoogleIcon";
import { toast } from "sonner";

/** The Google callback reports how linking went as a query param — it can't toast from a redirect. */
const LINK_ERRORS: Record<string, string> = {
  "google-failed": "Připojení účtu Google se nepodařilo dokončit. Zkuste to prosím znovu.",
  "session-mismatch": "Během připojování jste se odhlásili nebo přepnuli účet. Zkuste to prosím znovu.",
  "linked-to-another-account": "Tento Google účet už je propojený s jiným účtem Lonvita.",
  "already-has-google": "K účtu už je připojený jiný Google účet. Nejdřív ho odpojte.",
};

/** "Propojené účty" — the Google account(s) this person can sign in with, plus connecting one
 * from here (even under a different address than the account's) and disconnecting it. */
export function ConnectedAccountsCard() {
  const { user, refreshProfile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<LinkedAccountRow[] | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    if (!user) return;
    getAuthMode().then((m) => setGoogleEnabled(m.google));
    getMyLinkedAccounts(String(user.id))
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, [user]);

  useEffect(() => {
    const linked = searchParams.get("linked");
    const error = searchParams.get("link-error");
    if (!linked && !error) return;
    if (linked === "google") {
      toast.success("Google účet je připojený — přihlásit se můžete i přes Google.");
      // Linking may have brought the Google photo over as the avatar.
      refreshProfile();
    } else if (error) {
      toast.error(LINK_ERRORS[error] ?? LINK_ERRORS["google-failed"]);
    }
    // Drop the param so a reload doesn't toast again.
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const unlink = async (account: LinkedAccountRow) => {
    await unlinkAccount(account.id);
    setAccounts((prev) => prev?.filter((a) => a.id !== account.id) ?? []);
    toast.success("Google účet je odpojený.");
  };

  if (accounts === null) return null;
  // Nothing to show or offer — Google isn't set up here and nothing was linked before.
  if (!googleEnabled && accounts.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <p className="font-bold text-sm">Propojené účty</p>
        {accounts.map((account) => (
          <div key={account.id} className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <GoogleIcon className="h-5 w-5 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-base font-semibold">Google</p>
                <p className="text-sm text-muted-foreground mt-0.5 truncate">
                  {account.email ?? "Bez e-mailu"} · připojeno {new Date(account.linked_at).toLocaleDateString("cs-CZ")}
                </p>
              </div>
            </div>
            <UnlinkButton account={account} accountEmail={user?.email ?? ""} onConfirm={() => unlink(account)} />
          </div>
        ))}
        {accounts.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Připojte účet Google a přihlašujte se jedním kliknutím, bez hesla.
            </p>
            <Button type="button" variant="outline" onClick={linkGoogleRedirect} className="w-full h-12 text-base">
              <GoogleIcon />
              Připojit Google
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UnlinkButton({
  account,
  accountEmail,
  onConfirm,
}: {
  account: LinkedAccountRow;
  accountEmail: string;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async (e: React.MouseEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      toast.error("Google účet se nepodařilo odpojit.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="shrink-0">
          Odpojit
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Odpojit Google účet?</AlertDialogTitle>
          <AlertDialogDescription>
            Přes Google{account.email ? ` (${account.email})` : ""} se pak do Lonvity nepřihlásíte. Přihlásíte se
            e-mailem {accountEmail} a heslem — pokud heslo nemáte, nastavíte si ho přes „Zapomenuté heslo“ na
            přihlašovací stránce.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Zrušit</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={busy} className={buttonVariants({ variant: "destructive" })}>
            {busy ? "Odpojuji…" : "Odpojit"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
