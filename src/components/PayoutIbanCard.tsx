"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banknote, Check, Pencil } from "lucide-react";
import { updateProfile } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/** Velmi volné IBAN ověření — 2 písmena země + min 13 znaků (CZ má 24). */
function isPlausibleIban(s: string): boolean {
  const v = s.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v);
}

function formatIban(s: string): string {
  const v = s.replace(/\s+/g, "").toUpperCase();
  return v.replace(/(.{4})/g, "$1 ").trim();
}

export function PayoutIbanCard() {
  const { profile, refreshProfile } = useAuth();
  const [editing, setEditing] = useState(!profile?.payout_iban);
  const [value, setValue] = useState(profile?.payout_iban ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!profile) return;
    const cleaned = value.replace(/\s+/g, "").toUpperCase();
    if (cleaned && !isPlausibleIban(cleaned)) {
      toast.error("IBAN nevypadá správně. Zkontrolujte zápis.");
      return;
    }
    setSaving(true);
    try {
      await updateProfile(profile.id, { payoutIban: cleaned || null });
      toast.success(cleaned ? "Výplatní účet uložen." : "IBAN smazán.");
      await refreshProfile();
      setEditing(false);
    } catch {
      toast.error("Nepodařilo se uložit IBAN.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Banknote className="h-5 w-5 text-primary" />
          <p className="font-bold">Výplatní účet (IBAN)</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Potřeba pro pořádání placených akcí. Platforma vyplácí jednou měsíčně,
          po odečtení 5% provize.
        </p>

        {editing ? (
          <div className="space-y-2">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="CZ65 0800 0000 1920 0014 5399"
              className="h-12 font-mono tracking-wider"
              autoComplete="off"
            />
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={save} disabled={saving} className="h-11">
                <Check className="h-4 w-4" /> Uložit
              </Button>
              {profile?.payout_iban && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setValue(profile.payout_iban ?? "");
                    setEditing(false);
                  }}
                  className="h-11"
                >
                  Zrušit
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="flex-1 font-mono text-sm tracking-wider">
              {profile?.payout_iban ? formatIban(profile.payout_iban) : "—"}
            </p>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="h-10">
              <Pencil className="h-4 w-4" /> Změnit
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
