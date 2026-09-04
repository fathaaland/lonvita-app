"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings } from "lucide-react";
import { setMunicipalityRulesForCreation, RulesForCreation } from "@/integrations/payload/queries";
import { toast } from "sonner";

const OPTIONS: { value: RulesForCreation; label: string }[] = [
  { value: "municipality_only", label: "Akce může zakládat pouze obec sama" },
  { value: "anyone", label: "Kdokoliv v obci může zakládat akce bez schvalování" },
  { value: "approved_organizers", label: "Obec schvaluje každou žádost o roli organizátora" },
];

export function SettingsPanel({ municipalityId, initialRules }: { municipalityId: string; initialRules: RulesForCreation }) {
  const [rules, setRules] = useState<RulesForCreation>(initialRules);
  const [saving, setSaving] = useState(false);

  const handleChange = async (value: RulesForCreation) => {
    setRules(value);
    setSaving(true);
    try {
      await setMunicipalityRulesForCreation(municipalityId, value);
      toast.success("Nastavení uloženo.");
    } catch {
      toast.error("Nepodařilo se uložit nastavení.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" />
          <p className="font-bold">Pravidla pro vytváření akcí</p>
        </div>
        <Select value={rules} onValueChange={handleChange} disabled={saving}>
          <SelectTrigger className="h-12"><SelectValue /></SelectTrigger>
          <SelectContent>
            {OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
