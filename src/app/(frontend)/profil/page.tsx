"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
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
import { AccessibilityControls } from "@/components/AccessibilityControls";
import { LogOut, Settings, ArrowLeft, Mail, ShieldCheck, Building2, HandHeart } from "lucide-react";
import { toast } from "sonner";
import { VolunteerCard } from "@/components/VolunteerCard";
import { OrganizerRequestCard } from "@/components/OrganizerRequestCard";
import { NotificationPreferencesCard } from "@/components/NotificationPreferencesCard";
import { EventFeedbackCard } from "@/components/EventFeedbackCard";
import { ProfileAvatarEditor } from "@/components/ProfileAvatarEditor";
import { ConnectedAccountsCard } from "@/components/ConnectedAccountsCard";
import { Loading } from "@/components/Loading";

function ProfileContent() {
  const router = useRouter();
  const { user, profile, isSuperAdmin, isAdmin, isOrganizer, signOut } = useAuth();
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

  const roleLabel = isSuperAdmin ? "Superadmin" : isAdmin ? "Admin obce" : isOrganizer ? "Organizátor" : "Účastník";

  const handleSignOut = () => {
    signOut();
    toast.success("Odhlášeno.");
  };

  return (
    <div className="animate-fade-in md:mx-auto md:max-w-2xl">
      <div className="bg-brand-purple-pale text-foreground px-6 pt-8 pb-6 relative overflow-hidden md:rounded-b-2xl md:mt-6">
        {/* The halo the photo sits in — the header's only ornament. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-20 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(var(--brand-purple-light)/0.35)] ring-[24px] ring-[hsl(var(--brand-purple-light)/0.15)]"
        />
        <button
          onClick={() => router.back()}
          className="absolute top-4 left-4 z-10 h-9 w-9 rounded-full inline-flex items-center justify-center bg-card/70 hover:bg-card transition-colors"
          aria-label="Zpět"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="relative flex flex-col items-center text-center">
          <ProfileAvatarEditor />
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight">{profile?.full_name}</h1>
          <span className="eyebrow mt-1">{roleLabel}</span>
        </div>
      </div>

      <div className="bg-card border-b border-border grid grid-cols-3 divide-x divide-border md:border md:rounded-xl md:mt-4">
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
          <CardContent className="p-4">
            <AccessibilityControls />
          </CardContent>
        </Card>

        <NotificationPreferencesCard />

        <ConnectedAccountsCard />

        <EventFeedbackCard />

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
                    Doplňkové tipy navíc — nezávisle na notifikacích výše.
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

        {!isAdmin && <OrganizerRequestCard />}
        <VolunteerCard />

        {isOrganizer && (
          <Button asChild variant="outline" className="w-full h-14 text-base">
            <Link href="/organizace"><Building2 className="h-5 w-5" /> Organizace</Link>
          </Button>
        )}

        {profile?.is_volunteer && user && (
          <Button asChild variant="outline" className="w-full h-14 text-base">
            <Link href={`/dobrovolnik/${user.id}`}><HandHeart className="h-5 w-5" /> Moje karta dobrovolníka</Link>
          </Button>
        )}

        {isAdmin && (
          <Button asChild variant="outline" className="w-full h-14 text-base">
            <Link href="/admin-obce"><Settings className="h-5 w-5" /> Administrace obce</Link>
          </Button>
        )}

        {isSuperAdmin && (
          <Button asChild variant="outline" className="w-full h-14 text-base">
            <Link href="/superadmin"><ShieldCheck className="h-5 w-5" /> Panel superadmina</Link>
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
      {/* The Google link callback lands here with ?linked / ?link-error, read via useSearchParams. */}
      <Suspense fallback={<Loading />}>
        <ProfileContent />
      </Suspense>
    </RequireAuth>
  );
}
