"use client";

import { useState } from "react";
import { updateProfile } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bell, Mail } from "lucide-react";
import { toast } from "sonner";

/** Brief §7 "Preferovaný kanál notifikací (e-mail vs. v aplikaci), nastavitelný uživatelem" —
 * e-mail je defaultně zapnutý, aplikace (in-app) je volitelná; obojí nezávisle přepínatelné. */
export function NotificationPreferencesCard() {
  const { profile, refreshProfile } = useAuth();
  const [notifyEmail, setNotifyEmail] = useState(profile?.notify_email ?? true);
  const [notifyInApp, setNotifyInApp] = useState(profile?.notify_in_app ?? true);
  const [saving, setSaving] = useState(false);

  const update = async (field: "notifyEmail" | "notifyInApp", value: boolean) => {
    if (!profile) return;
    const revert = field === "notifyEmail" ? setNotifyEmail : setNotifyInApp;
    revert(value);
    setSaving(true);
    try {
      await updateProfile(profile.id, { [field]: value });
      await refreshProfile();
    } catch {
      revert(!value);
      toast.error("Nepodařilo se uložit nastavení.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <p className="font-bold text-sm">Notifikace</p>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Mail className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <Label htmlFor="notify-email" className="text-base font-semibold">E-mailem</Label>
              <p className="text-sm text-muted-foreground mt-0.5">Přihlášky, schválení, změny a zrušení akcí.</p>
            </div>
          </div>
          <Switch id="notify-email" checked={notifyEmail} onCheckedChange={(v) => update("notifyEmail", v)} disabled={saving} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Bell className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <Label htmlFor="notify-app" className="text-base font-semibold">V aplikaci</Label>
              <p className="text-sm text-muted-foreground mt-0.5">Stejná upozornění se objeví i ve zvonečku v appce.</p>
            </div>
          </div>
          <Switch id="notify-app" checked={notifyInApp} onCheckedChange={(v) => update("notifyInApp", v)} disabled={saving} />
        </div>
      </CardContent>
    </Card>
  );
}
