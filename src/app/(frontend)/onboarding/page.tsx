"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getEventCategories, updateProfile } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LonvitaLogo } from "@/components/LonvitaLogo";
import { toast } from "sonner";
import { Loading } from "@/components/Loading";
import { getCategoryIcon } from "@/lib/icons";
import { ArrowRight, ArrowLeft, Check, Phone } from "lucide-react";

// The home municipality is picked on the map at registration (/auth) — onboarding no longer asks.
const ONBOARDING_STEPS = 4;
// Lenient Czech mobile format: optional +420/00420 prefix, then 9 digits (spaces allowed).
const PHONE_RE = /^(\+420|00420)?\s?[0-9]{3}\s?[0-9]{3}\s?[0-9]{3}$/;

type Gender = "zena" | "muz" | "jine" | "neuvedeno";
type Category = { id: string; name: string; icon: string | null; color: string | null };

function OnboardingContent() {
  const router = useRouter();
  const { user, profile, refreshProfile, loading: authLoading } = useAuth();
  const [step, setStep] = useState(0);
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [phone, setPhone] = useState("");
  const [cats, setCats] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getEventCategories().then(setCats);
  }, []);

  // Prefill from the profile — an account created by a superadmin may already carry some of this.
  useEffect(() => {
    if (!profile) return;
    if (profile.date_of_birth) setDob(profile.date_of_birth.slice(0, 10));
    if (profile.gender) setGender(profile.gender as Gender);
    if (profile.interests?.length) setInterests(profile.interests);
    if (profile.phone) setPhone(profile.phone);
  }, [profile?.id]);

  // Redirect if already onboarded
  useEffect(() => {
    if (!authLoading && profile?.onboarding_completed) {
      router.replace("/");
    }
  }, [authLoading, profile, router]);

  const toggleInterest = (id: string) => {
    setInterests((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  };

  const finish = async () => {
    if (!user || !profile) return;
    setSaving(true);
    try {
      await updateProfile(profile.id, {
        dateOfBirth: dob || null,
        gender: gender ?? "neuvedeno",
        interests: interests.map(Number),
        phone: phone.trim(),
        onboardingCompleted: true,
      });
      toast.success("Vítejte v Lonvitě!");
      await refreshProfile();
      router.replace("/");
    } catch {
      toast.error("Nepodařilo se uložit profil.");
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) return <Loading />;

  const canNext =
    (step === 0 && !!dob) ||
    // "Raději neuvedu" is a valid answer too — only an untouched step blocks.
    (step === 1 && gender !== null) ||
    (step === 2) ||
    (step === 3 && PHONE_RE.test(phone.trim()));

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-6 pt-8 pb-4 flex items-center gap-3">
        <LonvitaLogo size="md" wordmark={false} />
        <div>
          <p className="text-xs text-muted-foreground">Pár krátkých otázek</p>
          <p className="font-extrabold">Krok {step + 1} ze {ONBOARDING_STEPS}</p>
        </div>
      </div>

      <div className="px-2 pb-2">
        <div className="h-1.5 bg-muted rounded-full overflow-hidden mx-4">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${((step + 1) / ONBOARDING_STEPS) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex-1 px-4 py-4">
        <Card>
          <CardContent className="p-5 space-y-4">
            {step === 0 && (
              <>
                <div>
                  <h2 className="text-xl font-extrabold">Kdy jste se narodil/a?</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Pomůže nám nabízet aktivity vhodné pro váš věk.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dob">Datum narození</Label>
                  <Input
                    id="dob"
                    type="date"
                    value={dob}
                    max="2000-12-31"
                    min="1920-01-01"
                    onChange={(e) => setDob(e.target.value)}
                    className="h-12 text-base"
                  />
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <div>
                  <h2 className="text-xl font-extrabold">Jak vás máme oslovovat?</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Vyberte, co je vám nejbližší.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { v: "zena", label: "Žena" },
                    { v: "muz", label: "Muž" },
                    { v: "jine", label: "Jiné" },
                    { v: "neuvedeno", label: "Raději neuvedu" },
                  ].map((g) => (
                    <Button
                      key={g.v}
                      variant={gender === g.v ? "default" : "outline"}
                      className="h-14 text-base"
                      onClick={() => setGender(g.v as Gender)}
                    >
                      {g.label}
                    </Button>
                  ))}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div>
                  <h2 className="text-xl font-extrabold">Co vás baví?</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Vyberte oblasti, které vás zajímají. Nabídneme vám je jako první.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {cats.map((c) => {
                    const Icon = getCategoryIcon(c.icon);
                    const active = interests.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleInterest(c.id)}
                        className={`rounded-xl border p-3 flex items-center gap-2 h-14 transition ${
                          active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="font-semibold">{c.name}</span>
                        {active && <Check className="h-4 w-4 ml-auto" />}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Vybráno: {interests.length}
                </p>
              </>
            )}

            {step === 3 && (
              <>
                <div>
                  <h2 className="text-xl font-extrabold">Vaše telefonní číslo</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Na tohle číslo vám pošleme SMS, pokud se akce, na kterou jste přihlášeni, zruší nebo změní.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Telefon</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+420 601 234 567"
                      className="h-12 text-base pl-9"
                    />
                  </div>
                  {phone.trim().length > 0 && !PHONE_RE.test(phone.trim()) && (
                    <p className="text-xs text-destructive">Zadejte prosím platné české telefonní číslo.</p>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="p-4 grid grid-cols-2 gap-2 sticky bottom-0 bg-background/95 backdrop-blur border-t">
        <Button
          variant="outline"
          className="h-12"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          <ArrowLeft className="h-4 w-4" /> Zpět
        </Button>
        {step < ONBOARDING_STEPS - 1 ? (
          <Button className="h-12" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
            Pokračovat <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button className="h-12" onClick={finish} disabled={!canNext || saving}>
            {saving ? "Ukládám…" : "Dokončit"} <Check className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <RequireAuth>
      <OnboardingContent />
    </RequireAuth>
  );
}
