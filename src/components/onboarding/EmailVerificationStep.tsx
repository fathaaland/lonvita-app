"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, LogOut, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LonvitaLogo } from "@/components/LonvitaLogo";
import { SignOutButton } from "@/components/SignOutButton";
import { PayloadApiError } from "@/integrations/payload/client";
import { resendEmailCode, verifyEmailCode } from "@/integrations/payload/queries";

const RESEND_COOLDOWN_SECONDS = 60;
// A code that just went out — a short pause before offering another, so the one already on its
// way isn't replaced while the person is still opening their inbox.
const FIRST_CODE_PAUSE_SECONDS = 20;

const initialCooldown = (codeSentAt: string | null): number => {
  if (!codeSentAt) return 0;
  const elapsed = Math.floor((Date.now() - new Date(codeSentAt).getTime()) / 1000);
  return Math.max(0, FIRST_CODE_PAUSE_SECONDS - elapsed);
};

/**
 * Onboarding's first screen for a password sign-up: the 6-digit code e-mailed on registration
 * (lib/auth/email-verification). A Google sign-up never sees it — Google proved the address.
 */
export function EmailVerificationStep({
  email,
  codeSentAt,
  onVerified,
}: {
  email: string;
  /** When the last code left; null = none ever did (an older account, or the e-mail failed). */
  codeSentAt: string | null;
  onVerified: () => void;
}) {
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);
  const [codeSent, setCodeSent] = useState(codeSentAt !== null);
  const [cooldown, setCooldown] = useState(() => initialCooldown(codeSentAt));

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const errorMessage = (error: unknown, fallback: string) =>
    error instanceof PayloadApiError && error.status < 500 ? error.message : fallback;

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    setVerifying(true);
    try {
      await verifyEmailCode(code);
      toast.success("E-mail ověřen.");
      onVerified();
    } catch (error) {
      toast.error(errorMessage(error, "Ověření se nepodařilo. Zkuste to za chvíli."));
      setCode("");
    } finally {
      setVerifying(false);
    }
  };

  const resend = async () => {
    setSending(true);
    try {
      await resendEmailCode();
      toast.success(`Nový kód jsme poslali na ${email}.`);
      setCode("");
      setCodeSent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      toast.error(errorMessage(error, "E-mail se nepodařilo odeslat. Zkuste to za chvíli."));
      if (error instanceof PayloadApiError && error.status === 429) setCooldown(RESEND_COOLDOWN_SECONDS);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-6 pt-8 pb-4 flex items-center gap-3">
        <LonvitaLogo size="md" wordmark={false} />
        <div>
          <p className="text-xs text-muted-foreground">Než začneme</p>
          <p className="font-extrabold">Ověření e-mailu</p>
        </div>
        <SignOutButton>
          <Button variant="ghost" size="sm" className="ml-auto h-10">
            <LogOut className="h-4 w-4" /> Odhlásit se
          </Button>
        </SignOutButton>
      </div>

      <div className="flex-1 px-4 py-4">
        <Card>
          <CardContent className="p-5">
            <form onSubmit={verify} className="space-y-4">
              <div>
                <h2 className="text-xl font-extrabold flex items-center gap-2">
                  <Mail className="h-5 w-5" /> Zadejte kód z e-mailu
                </h2>
                {codeSent ? (
                  <p className="text-sm text-muted-foreground mt-1">
                    Na adresu <span className="font-semibold text-foreground break-all">{email}</span> jsme poslali
                    šestimístný kód. Platí 15 minut. Nevidíte ho? Podívejte se i do složky se spamem.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-1">
                    Pošlete si šestimístný kód na adresu{" "}
                    <span className="font-semibold text-foreground break-all">{email}</span> tlačítkem níže a
                    zadejte ho sem.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="email-code">Ověřovací kód</Label>
                <Input
                  id="email-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  autoFocus
                  placeholder="123456"
                  className="h-14 text-center text-2xl font-mono tracking-[0.5em]"
                />
              </div>
              <Button type="submit" className="w-full h-12" disabled={code.length !== 6 || verifying}>
                {verifying ? "Ověřuji…" : "Ověřit"} <Check className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full h-12"
                onClick={resend}
                disabled={sending || cooldown > 0}
              >
                {sending
                  ? "Posílám…"
                  : cooldown > 0
                    ? `Poslat nový kód (${cooldown} s)`
                    : codeSent
                      ? "Poslat nový kód"
                      : "Poslat kód"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
