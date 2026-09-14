"use client";

import { useEffect, useState } from "react";
import { createOrganization, getMyOrganizations, OrganizationRow } from "@/integrations/payload/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  userId: string;
  /** Selected organization id, "" = published under the organizer's own name. */
  value: string;
  onChange: (organizationId: string) => void;
}

const chipClass = (active: boolean) =>
  cn(
    "px-3 py-2 rounded-full text-sm font-semibold border-[1.5px] transition-colors",
    active
      ? "bg-primary text-primary-foreground border-primary"
      : "bg-card text-foreground border-border hover:border-brand-purple",
  );

/** Brief §4 "Organizace" — pick which of the organizer's own organizations an event is published
 * under, or add a new one inline (free text, no obec approval). Plain chip buttons + an inline
 * input rather than a Select + window.prompt: that combination lost the freshly created
 * organization before the event was submitted, so events were saved without it. */
export function OrganizationPicker({ userId, value, onChange }: Props) {
  const [organizations, setOrganizations] = useState<OrganizationRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMyOrganizations(userId).then(setOrganizations).catch(() => setOrganizations([]));
  }, [userId]);

  const handleAdd = async () => {
    const name = newName.trim();
    if (name.length < 2) {
      toast.error("Zadejte název organizace.");
      return;
    }
    setSaving(true);
    try {
      const org = await createOrganization(name, userId);
      setOrganizations((prev) => [...prev, org].sort((a, b) => a.name.localeCompare(b.name, "cs")));
      onChange(org.id);
      setNewName("");
      setAdding(false);
    } catch {
      toast.error("Nepodařilo se přidat organizaci.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onChange("")} className={chipClass(value === "")}>
          Vlastní jméno
        </button>
        {organizations.map((o) => (
          <button key={o.id} type="button" onClick={() => onChange(o.id)} className={chipClass(value === o.id)}>
            {o.name}
          </button>
        ))}
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className={cn(chipClass(false), "inline-flex items-center gap-1")}>
            <Plus className="h-4 w-4" /> Nová organizace
          </button>
        )}
      </div>
      {adding && (
        <div className="flex gap-2">
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              // Enter would otherwise submit the whole event form.
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="Název organizace"
            className="h-12 flex-1"
          />
          <Button type="button" className="h-12" onClick={handleAdd} disabled={saving}>
            Přidat
          </Button>
          <Button type="button" variant="ghost" className="h-12" onClick={() => { setAdding(false); setNewName(""); }}>
            Zrušit
          </Button>
        </div>
      )}
    </div>
  );
}
