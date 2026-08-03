"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

// Password resets are handled entirely by Auth0's own hosted "change password" page,
// reached via the link in the reset email (triggered from Auth.tsx's "Zapomněli jste
// heslo?" action) — there is no in-app password form anymore. This route stays only as a
// friendly landing spot in case someone bookmarks/revisits the old link shape.
export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-background flex items-center">
      <div className="mx-auto max-w-[420px] w-full px-4 py-8 space-y-5 text-center">
        <h1 className="text-2xl font-extrabold">Obnova hesla</h1>
        <p className="text-muted-foreground">
          Odkaz pro obnovu hesla jsme vám poslali e-mailem — otevřete ho a dokončete tam
          nastavení nového hesla.
        </p>
        <Button asChild className="w-full h-12">
          <Link href="/auth">Zpět na přihlášení</Link>
        </Button>
      </div>
    </div>
  );
}
