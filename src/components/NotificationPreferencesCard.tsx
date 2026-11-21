"use client";

import { useState } from "react";
import { updateProfile } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bell, Mail, MessageSquare } from "lucide-react";
import { NOTIFICATION_CATEGORIES, categoriesVisibleTo } from "@/lib/notifications/categories";
import { useMunicipalityFeatures } from "@/hooks/useMunicipalityFeatures";
import { SMS_LARGE_EVENT_CAPACITY } from "@/lib/capacity";
import { toast } from "sonner";

/** Brief §7 "Preferovaný kanál notifikací (e-mail vs. v aplikaci), nastavitelný uživatelem" —
 * e-mail je defaultně zapnutý, aplikace (in-app) je volitelná; obojí nezávisle přepínatelné. */
export function NotificationPreferencesCard() {
  const { profile, refreshProfile, isOrganizer, isAdmin } = useAuth();
  const [notifyEmail, setNotifyEmail] = useState(profile?.notify_email ?? true);
  const [muted, setMuted] = useState<string[]>(profile?.email_muted ?? []);
  const [notifySms, setNotifySms] = useState(profile?.notify_sms ?? false);
  // SMS are offered only where the home obec has them (the SMS package).
  const { sms: obecSendsSms } = useMunicipalityFeatures(profile?.municipality_id ?? null);
  const [saving, setSaving] = useState(false);

  const update = async (field: "notifyEmail" | "notifySms", value: boolean) => {
    if (!profile) return;
    const revert = { notifyEmail: setNotifyEmail, notifySms: setNotifySms }[field];
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

  // A circle is on unless they switched it off — what a switch shows is "e-mail wanted".
  const toggleCategory = async (key: string, wanted: boolean) => {
    if (!profile) return;
    const previous = muted;
    const next = wanted ? muted.filter((k) => k !== key) : [...muted, key];
    setMuted(next);
    setSaving(true);
    try {
      await updateProfile(profile.id, { emailMuted: next });
      await refreshProfile();
    } catch {
      setMuted(previous);
      toast.error("Nepodařilo se uložit nastavení.");
    } finally {
      setSaving(false);
    }
  };

  const visible = categoriesVisibleTo({ organizer: isOrganizer, obecAdmin: isAdmin });
  const always = NOTIFICATION_CATEGORIES.filter((c) => c.locked && (c.key !== "obec_billing" || isAdmin));

  return (
    <Card id="notifikace">
      <CardContent className="p-4 space-y-4">
        <p className="font-bold text-sm">Notifikace</p>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Mail className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <Label htmlFor="notify-email" className="text-base font-semibold">E-mailem</Label>
              <p className="text-sm text-muted-foreground mt-0.5">Vypněte všechny e-maily, nebo si níže vyberte, co chcete dostávat.</p>
            </div>
          </div>
          <Switch id="notify-email" checked={notifyEmail} onCheckedChange={(v) => update("notifyEmail", v)} disabled={saving} />
        </div>
        {notifyEmail && (
          <div className="space-y-3 rounded-lg bg-muted/50 p-3">
            {visible.map((c) => (
              <div key={c.key} className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor={`notify-${c.key}`} className="text-sm font-semibold">{c.label}</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
                </div>
                <Switch
                  id={`notify-${c.key}`}
                  checked={!muted.includes(c.key)}
                  onCheckedChange={(v) => toggleCategory(c.key, v)}
                  disabled={saving}
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Vždy vám přijdou: {always.map((c) => c.label.toLowerCase()).join(", ")}.
            </p>
          </div>
        )}
        <div className="flex items-start gap-2.5">
          <Bell className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-base font-semibold">V aplikaci</p>
            <p className="text-sm text-muted-foreground mt-0.5">Všechna upozornění najdete ve zvonečku v appce.</p>
          </div>
        </div>
        {(obecSendsSms || notifySms) && (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <MessageSquare className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <Label htmlFor="notify-sms" className="text-base font-semibold">SMS</Label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {profile?.phone
                    ? `Zrušení akce i na telefon. Neplatí pro akce pro ${SMS_LARGE_EVENT_CAPACITY} a více lidí.`
                    : "Nejdřív si v osobních údajích doplňte telefon."}
                </p>
              </div>
            </div>
            <Switch
              id="notify-sms"
              checked={notifySms}
              onCheckedChange={(v) => update("notifySms", v)}
              disabled={saving || (!profile?.phone && !notifySms)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
