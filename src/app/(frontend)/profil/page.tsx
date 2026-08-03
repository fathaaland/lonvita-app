"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  hasPendingOrganizerRequest,
  getMyRegistrationsWithEvents,
  getMarketingConsent,
  setMarketingConsent,
} from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useFontSize } from "@/contexts/FontSizeContext";
import { LogOut, Type, UserPlus, Settings, ArrowLeft, Mail } from "lucide-react";
import { toast } from "sonner";
import { PayoutIbanCard } from "@/components/PayoutIbanCard";
import { VolunteerCard } from "@/components/VolunteerCard";

function ProfileContent() {
  const router = useRouter();
  const { user, profile, isAdmin, isOrganizer, signOut } = useAuth();
  const { size, setSize } = useFontSize();
  const [hasPendingRequest, setHasPendingRequest] = useState(false);
  const [stats, setStats] = useState({ upcoming: 0, attended: 0, volunteerHours: 0 });
  const [marketingConsent, setMarketingConsentState] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);

  useEffect(() => {
    if (!user) return;
    getMarketingConsent(String(user.id)).then(setMarketingConsentState);
  }, [user]);

  const toggleMarketingConsent = async (checked: boolean) => {
    if (!user) return;
    setSavingConsent(true);
    setMarketingConsentState(checked);
    try {
      await setMarketingConsent(String(user.id), checked);
    } catch {
      setMarketingConsentState(!checked);
      toast.error("Nepodařilo se uložit nastavení.");
    } finally {
      setSavingConsent(false);
    }
  };

  useEffect(() => {
    if (!user || isOrganizer) return;
    hasPendingOrganizerRequest(String(user.id)).then(setHasPendingRequest);
  }, [user, isOrganizer]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const nowIso = new Date().toISOString();
      const regs = await getMyRegistrationsWithEvents(String(user.id));
      const approved = regs.filter((r) => r.status === "approved" && r.events);
      const upcoming = approved.filter((r) => r.events!.date_time >= nowIso).length;
      const attended = approved.filter((r) => r.events!.date_time < nowIso).length;
      setStats({ upcoming, attended, volunteerHours: attended * 2 });
    })();
  }, [user]);

  const roleLabel = isAdmin ? "Admin obce" : isOrganizer ? "Pořadatel" : "Účastník";
  const initials = (profile?.full_name ?? "?").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();

  const handleSignOut = () => {
    signOut();
    toast.success("Odhlášeno.");
  };

  return (
    <div className="animate-fade-in">
      <div className="bg-brand-graphite text-[hsl(var(--brand-ivory))] px-6 pt-6 pb-5 relative">
        <button
          onClick={() => router.back()}
          className="absolute top-4 left-4 h-9 w-9 rounded-full inline-flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors"
          aria-label="Zpět"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex flex-col items-center text-center">
          <div className="h-[72px] w-[72px] rounded-full bg-brand-purple-pale border-[3px] border-brand-purple flex items-center justify-center text-brand-purple-dark text-2xl font-extrabold">
            {initials}
          </div>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight">{profile?.full_name}</h1>
          <span className="eyebrow eyebrow-sage mt-1">{roleLabel}</span>
        </div>
      </div>

      <div className="bg-card border-b border-border grid grid-cols-3 divide-x divide-border">
        {[
          { num: stats.upcoming, label: "Nadcházející" },
          { num: stats.attended, label: "Navštíveno" },
          { num: stats.volunteerHours, label: "Dobr. hodin" },
        ].map((s) => (
          <div key={s.label} className="py-4 text-center">
            <div className="text-xl font-extrabold text-brand-purple-dark tracking-tight">{s.num}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="px-4 py-5 space-y-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="eyebrow"><Type className="h-3 w-3" /> Velikost písma</div>
            <div className="grid grid-cols-3 gap-2">
              {(["normal", "large", "xlarge"] as const).map((s) => (
                <Button key={s} variant={size === s ? "default" : "outline"} onClick={() => setSize(s)} className="h-12">
                  <span className={s === "normal" ? "text-base" : s === "large" ? "text-lg" : "text-2xl"}>A</span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Mail className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <Label htmlFor="marketing-consent" className="text-base font-semibold">
                    Novinky a tipy na akce e-mailem
                  </Label>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Potvrzení o přihláškách dostáváte vždy — tohle je jen navíc.
                  </p>
                </div>
              </div>
              <Switch
                id="marketing-consent"
                checked={marketingConsent}
                onCheckedChange={toggleMarketingConsent}
                disabled={savingConsent}
              />
            </div>
          </CardContent>
        </Card>

        {isOrganizer && <PayoutIbanCard />}

        {!isAdmin && <VolunteerCard />}

        {!isOrganizer && !isAdmin && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2"><UserPlus className="h-5 w-5 text-accent" /><p className="font-bold">Stát se pořadatelem</p></div>
              {hasPendingRequest ? (
                <p className="text-sm text-muted-foreground">Vaše žádost čeká na schválení.</p>
              ) : (
                <Button asChild variant="outline" className="w-full h-12">
                  <Link href="/zadost-poradatel">Podat žádost</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Button asChild variant="outline" className="w-full h-14 text-base">
            <Link href="/admin-obce"><Settings className="h-5 w-5" /> Administrace obce</Link>
          </Button>
        )}

        <Button onClick={handleSignOut} variant="outline" className="w-full h-14 text-base">
          <LogOut className="h-5 w-5" /> Odhlásit se
        </Button>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileContent />
    </RequireAuth>
  );
}
