"use client";

import { useEffect, useState } from "react";
import {
  redirectToLogin,
  registerAccount,
  requestPasswordReset,
  getAuthMode,
  loginWithPassword,
  requestNativePasswordReset,
} from "@/integrations/payload/client";
import { listMunicipalities, getMyRoles, MunicipalityRow } from "@/integrations/payload/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { z } from "zod";
import { Mail, Lock, User as UserIcon, MapPin } from "lucide-react";
import { LonvitaLogo } from "@/components/LonvitaLogo";

const signUpSchema = z.object({
  email: z.string().trim().email("Zadejte platný e-mail").max(255),
  password: z.string().min(8, "Heslo musí mít alespoň 8 znaků").max(128),
  full_name: z.string().trim().min(2, "Zadejte celé jméno").max(80),
  municipality: z.string().min(1, "Vyberte obec"),
  consent_accepted: z.boolean().refine((v) => v === true, "Musíte souhlasit s podmínkami používání"),
});

export default function AuthPage() {
  const [authUsesAuth0, setAuthUsesAuth0] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [municipalities, setMunicipalities] = useState<Pick<MunicipalityRow, "id" | "name">[]>([]);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getAuthMode().then((m) => setAuthUsesAuth0(m.auth0));
  }, []);

  useEffect(() => {
    if (mode !== "signup") return;
    listMunicipalities().then((list) => {
      setMunicipalities(list);
      if (list.length === 1) setMunicipality(list[0].id);
    });
  }, [mode]);

  // Auth0 owns the password check on its own hosted page for signin — we only need a
  // password field here when running on the no-Auth0 fallback (Payload's own local auth).
  const auth0SignInSchema = z.object({ email: z.string().trim().email("Zadejte platný e-mail").max(255) });
  const localSignInSchema = z.object({
    email: z.string().trim().email("Zadejte platný e-mail").max(255),
    password: z.string().min(1, "Zadejte heslo"),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === "signup") {
      const parsed = signUpSchema.safeParse({
        email,
        password,
        full_name: fullName,
        municipality,
        consent_accepted: consentAccepted,
      });
      if (!parsed.success) {
        toast.error(parsed.error.issues[0].message);
        return;
      }
      setLoading(true);
      try {
        await registerAccount({
          email: parsed.data.email,
          password: parsed.data.password,
          fullName: parsed.data.full_name,
          municipality: parsed.data.municipality,
          consentAccepted: parsed.data.consent_accepted,
          marketingConsent,
        });
        toast.success("Účet vytvořen. Můžete se přihlásit.");
        setMode("signin");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Registrace se nezdařila.");
      } finally {
        setLoading(false);
      }
    } else if (authUsesAuth0) {
      const parsed = auth0SignInSchema.safeParse({ email });
      if (!parsed.success) {
        toast.error(parsed.error.issues[0].message);
        return;
      }
      // Auth0 owns the actual password check on its own hosted login page.
      redirectToLogin({ returnTo: "/", loginHint: parsed.data.email });
    } else {
      const parsed = localSignInSchema.safeParse({ email, password });
      if (!parsed.success) {
        toast.error(parsed.error.issues[0].message);
        return;
      }
      setLoading(true);
      try {
        const loggedInUser = await loginWithPassword(parsed.data.email, parsed.data.password);
        const roles = await getMyRoles(String(loggedInUser.id));
        // Full reload so AuthContext (and everything gated on it) picks up the new session.
        window.location.href = roles.includes("municipality_admin") ? "/admin-obce" : "/";
      } catch {
        toast.error("Nesprávný e-mail nebo heslo.");
        setLoading(false);
      }
    }
  };

  const signInGoogle = () => {
    redirectToLogin({ returnTo: "/", connection: "google-oauth2" });
  };

  const handleForgot = async () => {
    if (!email) {
      toast.error("Zadejte nejprve e-mail.");
      return;
    }
    try {
      if (authUsesAuth0) {
        await requestPasswordReset(email);
      } else {
        await requestNativePasswordReset(email);
      }
      toast.success("Odkaz pro obnovení hesla jsme vám poslali e-mailem.");
    } catch {
      toast.error("Nepodařilo se odeslat odkaz pro obnovení hesla.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[480px]">
        <div className="relative pb-10">
          <div className="absolute inset-0 bg-gradient-to-b from-[hsl(var(--brand-graphite))] via-[hsl(var(--brand-graphite-mid))] to-background" />
          <div className="relative pt-12 pb-4 px-6 flex flex-col items-center text-center">
            <LonvitaLogo variant="on-dark" size="xl" />
            <p className="mt-5 text-[15px] leading-relaxed text-[hsl(var(--brand-sand))] max-w-[320px]">
              Objevujte, co se děje ve vašem městě.
            </p>
          </div>
        </div>

        <div className="px-4 pb-8 relative z-10 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="fullName" className="text-base">Celé jméno</Label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Jan Novák"
                    className="pl-10 h-12 text-base"
                    autoComplete="name"
                  />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-base">E-mail</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vas@email.cz"
                  className="pl-10 h-12 text-base"
                  autoComplete="email"
                />
              </div>
            </div>
            {(mode === "signup" || authUsesAuth0 === false) && (
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-base">Heslo</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pl-10 h-12 text-base"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  />
                </div>
              </div>
            )}
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="municipality" className="text-base">Obec</Label>
                <Select value={municipality} onValueChange={setMunicipality}>
                  <SelectTrigger id="municipality" className="h-12 text-base">
                    <MapPin className="h-5 w-5 text-muted-foreground mr-1" />
                    <SelectValue placeholder="Vyberte obec" />
                  </SelectTrigger>
                  <SelectContent>
                    {municipalities.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {mode === "signup" && (
              <div className="space-y-2.5 pt-1">
                <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                  <Checkbox
                    checked={consentAccepted}
                    onCheckedChange={(v) => setConsentAccepted(v === true)}
                    className="mt-0.5"
                  />
                  <span>Souhlasím s podmínkami používání Lonvity.</span>
                </label>
                <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                  <Checkbox
                    checked={marketingConsent}
                    onCheckedChange={(v) => setMarketingConsent(v === true)}
                    className="mt-0.5"
                  />
                  <span>Chci dostávat novinky a tipy na akce e-mailem (nepovinné).</span>
                </label>
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full h-14 text-base font-semibold">
              {mode === "signin" ? "Přihlásit se" : "Vytvořit účet"}
            </Button>

            {mode === "signin" && authUsesAuth0 && (
              <Button type="button" variant="outline" onClick={signInGoogle} className="w-full h-12 text-base">
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"/>
                </svg>
                Přihlásit se přes Google
              </Button>
            )}
          </form>

          <div className="text-center space-y-2 pt-2">
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="text-sm text-primary font-semibold underline-offset-4 hover:underline"
            >
              {mode === "signin" ? "Nemáte účet? Zaregistrujte se" : "Už máte účet? Přihlaste se"}
            </button>
            {mode === "signin" && (
              <div>
                <button
                  type="button"
                  onClick={handleForgot}
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  Zapomněli jste heslo?
                </button>
              </div>
            )}
          </div>

          <p className="text-xs text-center text-muted-foreground pt-4">
            Přihlášením souhlasíte s tím, že vystupujete pod svým skutečným jménem.
          </p>
        </div>
      </div>
    </div>
  );
}
