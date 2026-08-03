"use client";

import { useEffect, useState } from "react";
import { updateProfile } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { HandHeart } from "lucide-react";
import { toast } from "sonner";

export const VOLUNTEER_FOCUS_OPTIONS: { value: string; label: string }[] = [
  { value: "doprava", label: "Pomoc s dopravou" },
  { value: "akce", label: "Pomoc na akcích" },
  { value: "it", label: "IT a technologie" },
  { value: "kultura", label: "Kultura a vzdělávání" },
  { value: "sport", label: "Sport a pohyb" },
  { value: "socialni", label: "Sociální pomoc a doprovod" },
  { value: "priroda", label: "Příroda a údržba" },
  { value: "jine", label: "Jiné" },
];

export function VolunteerCard() {
  const { profile, refreshProfile } = useAuth();
  const [isVolunteer, setIsVolunteer] = useState(!!profile?.is_volunteer);
  const [focus, setFocus] = useState<string[]>(profile?.volunteer_focus ?? []);
  const [note, setNote] = useState(profile?.volunteer_note ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setIsVolunteer(!!profile?.is_volunteer);
    setFocus(profile?.volunteer_focus ?? []);
    setNote(profile?.volunteer_note ?? "");
    setPhone(profile?.phone ?? "");
  }, [profile?.id]);

  const toggleFocus = (v: string) => {
    setFocus((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  };

  const save = async () => {
    if (!profile) return;
    if (isVolunteer && focus.length === 0) {
      toast.error("Vyberte alespoň jednu oblast, ve které chcete pomoci.");
      return;
    }
    setSaving(true);
    const trimmedNote = note.trim().slice(0, 500);
    const trimmedPhone = phone.trim().slice(0, 40);
    try {
      await updateProfile(profile.id, {
        isVolunteer,
        volunteerFocus: isVolunteer ? focus : [],
        volunteerNote: isVolunteer ? (trimmedNote || null) : null,
        volunteerSince: isVolunteer ? (profile.volunteer_since ?? new Date().toISOString()) : null,
        phone: trimmedPhone || null,
      });
      toast.success(isVolunteer ? "Zapsáno do poolu dobrovolníků." : "Uloženo.");
      await refreshProfile();
    } catch {
      toast.error("Nepodařilo se uložit.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <HandHeart className="h-5 w-5 text-[hsl(var(--brand-purple))]" />
            <div>
              <p className="font-bold">Pool dobrovolníků obce</p>
              <p className="text-sm text-muted-foreground">
                Přihlaste se a obec vás bude moci oslovit, když bude potřeba pomoc.
              </p>
            </div>
          </div>
          <Switch checked={isVolunteer} onCheckedChange={setIsVolunteer} aria-label="Chci být dobrovolník" />
        </div>

        {isVolunteer && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Na co bych se rád(a) zaměřoval(a)</Label>
              <div className="flex flex-wrap gap-2">
                {VOLUNTEER_FOCUS_OPTIONS.map((o) => {
                  const active = focus.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => toggleFocus(o.value)}
                      className={
                        "px-3 h-10 rounded-full border text-sm transition-colors " +
                        (active
                          ? "bg-[hsl(var(--brand-purple))] text-white border-transparent"
                          : "bg-background border-border text-foreground hover:bg-muted")
                      }
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vol-phone">Kontaktní telefon (pro obec)</Label>
              <Input id="vol-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+420…" maxLength={40} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vol-note">Krátká poznámka pro obec (nepovinné)</Label>
              <Textarea
                id="vol-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Např. mám auto, mohu pomoci vozit lidi na akce…"
                maxLength={500}
                rows={3}
              />
            </div>
          </div>
        )}

        <Button onClick={save} disabled={saving} className="w-full h-11">
          {saving ? "Ukládám…" : isVolunteer ? "Uložit a přihlásit se do poolu" : "Uložit"}
        </Button>
      </CardContent>
    </Card>
  );
}
