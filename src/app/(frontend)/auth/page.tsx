"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  redirectToGoogle,
  registerAccount,
  requestPasswordReset,
  getAuthMode,
  loginWithPassword,
} from "@/integrations/payload/client";
import { listMunicipalities, getMyProfile, getMyRoles, MunicipalityRow } from "@/integrations/payload/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { MunicipalityPicker } from "@/components/map/MunicipalityPicker";
import { toast } from "sonner";
import { GoogleIcon } from "@/components/GoogleIcon";
import { z } from "zod";
import { Mail, Lock, User as UserIcon } from "lucide-react";
import { LonvitaLogo } from "@/components/LonvitaLogo";

/** The Google callback can only report failures as a query param, so it sends a code and the
 * wording lives here. Never the provider's own message — it echoes request details. */
const GOOGLE_ERRORS: Record<string, string> = {
  "google-failed": "Přihlášení přes Google se nepodařilo dokončit. Zkuste to prosím znovu.",
  "google-unavailable": "Přihlášení přes Google teď není k dispozici. Použijte e-mail a heslo.",
  "google-email-unverified":
    "Google u tohoto účtu nemá ověřenou e-mailovou adresu. Ověřte ji u Googlu, nebo se přihlaste e-mailem a heslem.",
  "google-no-email": "Z účtu Google se nepodařilo získat e-mailovou adresu, bez které účet nezaložíme.",
};

const signUpSchema = z
  .object({
    email: z.string().trim().email("Zadejte platný e-mail").max(255),
    password: z.string().min(8, "Heslo musí mít alespoň 8 znaků").max(128),
    full_name: z.string().trim().min(2, "Zadejte celé jméno").max(80),
    municipality: z.string(),
    no_municipality: z.boolean(),
    consent_accepted: z.boolean().refine((v) => v === true, "Musíte souhlasit s podmínkami používání"),
  })
  .refine((v) => v.no_municipality || v.municipality.length > 0, {
    message: "Vyberte svou obec — klepněte na pole „Vaše obec“ a najděte ji na mapě.",
  });

function AuthPageContent() {
  const searchParams = useSearchParams();
  const [googleEnabled, setGoogleEnabled] = useState(false);
  // Guest CTAs on the homepage link straight to /auth?mode=signup — without this they'd land
  // on the sign-in form and need an extra click to find "Nemáte účet? Zaregistrujte se".
  const [mode, setMode] = useState<"signin" | "signup">(
    searchParams.get("mode") === "signup" ? "signup" : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [municipality, setMunicipality] = useState("");
  // Brief/notes: the user's town doesn't use Lonvita yet — they see events from every obec instead.
  const [noMunicipality, setNoMunicipality] = useState(false);
  const [municipalities, setMunicipalities] = useState<Pick<MunicipalityRow, "id" | "name" | "lat" | "lng">[]>([]);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getAuthMode().then((m) => setGoogleEnabled(m.google));
  }, []);

  // The Google callback reports failures as a query param — it can't toast from a redirect.
  useEffect(() => {
    const error = searchParams.get("error");
    if (error && error in GOOGLE_ERRORS) toast.error(GOOGLE_ERRORS[error]);
  }, [searchParams]);

  useEffect(() => {
    if (mode !== "signup") return;
    listMunicipalities().then(setMunicipalities);
  }, [mode]);

  const signInSchema = z.object({
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
        no_municipality: noMunicipality,
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
          municipality: parsed.data.no_municipality ? null : parsed.data.municipality,
          noMunicipality: parsed.data.no_municipality,
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
    } else {
      const parsed = signInSchema.safeParse({ email, password });
      if (!parsed.success) {
        toast.error(parsed.error.issues[0].message);
        return;
      }
      setLoading(true);
      try {
        const loggedInUser = await loginWithPassword(parsed.data.email, parsed.data.password);
        const userId = String(loggedInUser.id);
        // The profile decides this as much as the roles do: someone who hasn't been through
        // onboarding belongs on /onboarding, and sending them to "/" first meant the app
        // rendered around them for as long as the bounce took. Resolve it here, where the
        // answer is already one request away, instead of letting the destination page redo it.
        const [roles, profile] = await Promise.all([getMyRoles(userId), getMyProfile(userId)]);
        // Full reload so AuthContext (and everything gated on it) picks up the new session.
        window.location.href =
          loggedInUser.role === "admin"
            ? "/superadmin"
            : !profile?.onboarding_completed
              ? "/onboarding"
              : roles.includes("municipality_admin")
                ? "/admin-obce"
                : "/";
      } catch {
        toast.error("Nesprávný e-mail nebo heslo.");
        setLoading(false);
      }
    }
  };

  const signInGoogle = () => {
    redirectToGoogle("/");
  };

  const handleForgot = async () => {
    if (!email) {
      toast.error("Zadejte nejprve e-mail.");
      return;
    }
    try {
      await requestPasswordReset(email);
      toast.success("Odkaz pro obnovení hesla jsme vám poslali e-mailem.");
    } catch {
      toast.error("Nepodařilo se odeslat odkaz pro obnovení hesla.");
    }
  };

  const isSignUp = mode === "signup";

  return (
    <div className="w-full">
      {/* On lg+ the branding already lives in AppShell's split-screen panel. */}
      <div className="relative pb-10 lg:hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[hsl(var(--brand-graphite))] via-[hsl(var(--brand-graphite-mid))] to-background" />
        <div className="relative pt-12 pb-4 px-6 flex flex-col items-center text-center">
          <LonvitaLogo variant="on-dark" size="xl" />
          <p className="mt-5 text-[15px] leading-relaxed text-[hsl(var(--brand-sand))] max-w-[320px]">
            Objevujte, co se děje ve vašem městě.
          </p>
        </div>
      </div>

      <div className="px-4 pb-8 lg:px-0 lg:pb-0 relative z-10 space-y-5">
          <div className="space-y-1.5">
            <h1 className="text-[1.75rem] font-bold leading-tight tracking-[-0.01em]">
              {isSignUp ? "Založte si účet" : "Vítejte zpátky"}
            </h1>
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              {isSignUp
                ? "Pár údajů, vyberete obec a jste v obraze."
                : "Přihlaste se a podívejte se, co se u vás chystá."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
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
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="municipality" className="text-base">Vaše obec</Label>
                <MunicipalityPicker
                  id="municipality"
                  points={municipalities}
                  value={{ id: municipality, noMunicipality }}
                  onChange={({ id, noMunicipality: none }) => {
                    setMunicipality(id);
                    setNoMunicipality(none);
                  }}
                />
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {noMunicipality
                    ? "Uvidíte akce ze všech obcí. Svoji obec si můžete vybrat později v profilu."
                    : "Určuje, čí akce uvidíte. Změnit ji jde kdykoliv později v profilu."}
                </p>
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

            <Button type="submit" disabled={loading} className="mt-2 w-full h-14 text-base font-semibold">
              {mode === "signin" ? "Přihlásit se" : "Vytvořit účet"}
            </Button>

            {googleEnabled && (
              <Button type="button" variant="outline" onClick={signInGoogle} className="w-full h-12 text-base">
                <GoogleIcon />
                {isSignUp ? "Zaregistrovat se přes Google" : "Přihlásit se přes Google"}
              </Button>
            )}
          </form>

          <div className="space-y-2.5 text-center">
            {mode === "signin" && (
              <button
                type="button"
                onClick={handleForgot}
                className="text-[15px] text-muted-foreground underline-offset-4 hover:underline"
              >
                Zapomněli jste heslo?
              </button>
            )}
            {/* The question is text and only the action is a link — the whole sentence as one
                link made the target vague about what clicking it actually does. */}
            <p className="text-[15px] text-muted-foreground">
              {isSignUp ? "Už máte účet? " : "Nemáte účet? "}
              <button
                type="button"
                onClick={() => setMode(isSignUp ? "signin" : "signup")}
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                {isSignUp ? "Přihlaste se" : "Zaregistrujte se"}
              </button>
            </p>
          </div>

          {!isSignUp && (
            <p className="text-[13px] leading-relaxed text-center text-muted-foreground">
              Přihlášením souhlasíte s tím, že vystupujete pod svým skutečným jménem.
            </p>
          )}
        </div>
      </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthPageContent />
    </Suspense>
  );
}

