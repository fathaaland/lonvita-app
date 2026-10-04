"use client";

import { useEffect, useState } from "react";
import { Check, Pencil, Phone, UserRound } from "lucide-react";
import { toast } from "sonner";
import { getEventCategories, updateProfile } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCategoryIcon } from "@/lib/icons";

// Lenient Czech mobile format: optional +420/00420 prefix, then 9 digits (spaces allowed).
const PHONE_RE = /^(\+420|00420)?\s?[0-9]{3}\s?[0-9]{3}\s?[0-9]{3}$/;

type Gender = "zena" | "muz" | "jine" | "neuvedeno";
const GENDERS: { v: Gender; label: string }[] = [
  { v: "zena", label: "Žena" },
  { v: "muz", label: "Muž" },
  { v: "jine", label: "Jiné" },
  { v: "neuvedeno", label: "Raději neuvedu" },
];
type Category = { id: string; name: string; icon: string | null };

/** What onboarding asked — phone (SMS about changes to the events they signed up for), date of
 * birth, gender and interests — changeable here any time afterwards. Only they and a platform
 * admin see it; the phone also whoever runs an event they signed up for (Profiles field access).
 * The card itself shows none of it — only in the dialog, so it isn't on screen for whoever is
 * looking over their shoulder. */
export function PersonalDetailsCard() {
  const { profile, refreshProfile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<Gender>("neuvedeno");
  const [interests, setInterests] = useState<string[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getEventCategories().then(setCats);
  }, []);

  const startEditing = () => {
    if (!profile) return;
    setPhone(profile.phone ?? "");
    setDob(profile.date_of_birth?.slice(0, 10) ?? "");
    setGender((profile.gender as Gender | null) ?? "neuvedeno");
    setInterests(profile.interests ?? []);
    setEditing(true);
  };

  const toggleInterest = (id: string) =>
    setInterests((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));

  // Empty is fine — no number, no SMS.
  const phoneValid = phone.trim() === "" || PHONE_RE.test(phone.trim());

  const save = async () => {
    if (!profile || !phoneValid) return;
    setSaving(true);
    try {
      await updateProfile(profile.id, {
        phone: phone.trim(),
        dateOfBirth: dob || null,
        gender,
        interests: interests.map(Number),
      });
      await refreshProfile();
      toast.success("Údaje uloženy.");
      setEditing(false);
    } catch {
      toast.error("Nepodařilo se uložit údaje.");
    } finally {
      setSaving(false);
    }
  };

  if (!profile) return null;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-bold text-sm flex items-center gap-2">
            <UserRound className="h-4 w-4" /> Osobní údaje
          </p>
          <Button variant="ghost" size="sm" onClick={startEditing} className="gap-1.5">
            <Pencil className="h-4 w-4" /> Upravit
          </Button>
        </div>
      </CardContent>

      <Dialog open={editing} onOpenChange={(open) => !saving && setEditing(open)}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Osobní údaje</DialogTitle>
            <DialogDescription>
              Vidíte je jen vy. Telefon uvidí i pořadatel akce, na kterou se přihlásíte.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="details-phone">Telefon</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="details-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+420 601 234 567"
                  className="h-12 text-base pl-9"
                />
              </div>
              {!phoneValid ? (
                <p className="text-xs text-destructive">Zadejte prosím platné české telefonní číslo.</p>
              ) : (
                <p className="text-xs text-muted-foreground">Pošleme na něj SMS, když se akce, na kterou jste přihlášeni, zruší nebo změní.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="details-dob">Datum narození</Label>
              <Input
                id="details-dob"
                type="date"
                value={dob}
                max="2000-12-31"
                min="1920-01-01"
                onChange={(e) => setDob(e.target.value)}
                className="h-12 text-base"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Pohlaví</Label>
              <div className="grid grid-cols-2 gap-2">
                {GENDERS.map((g) => (
                  <Button
                    key={g.v}
                    type="button"
                    variant={gender === g.v ? "default" : "outline"}
                    className="h-12"
                    onClick={() => setGender(g.v)}
                  >
                    {g.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Co vás baví</Label>
              <div className="grid grid-cols-2 gap-2">
                {cats.map((c) => {
                  const Icon = getCategoryIcon(c.icon);
                  const active = interests.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleInterest(c.id)}
                      className={`rounded-xl border p-3 flex items-center gap-2 h-12 transition ${
                        active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="font-semibold text-sm">{c.name}</span>
                      {active && <Check className="h-4 w-4 ml-auto" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter className="grid grid-cols-2 gap-2 sm:space-x-0">
            <Button variant="outline" className="h-12" onClick={() => setEditing(false)} disabled={saving}>
              Zrušit
            </Button>
            <Button className="h-12" onClick={save} disabled={saving || !phoneValid}>
              {saving ? "Ukládám…" : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
