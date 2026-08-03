"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createOrganizerRequest } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

function OrganizerRequestContent() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (description.trim().length < 20) {
      toast.error("Popište prosím podrobněji, co plánujete pořádat (alespoň 20 znaků).");
      return;
    }
    if (!user || !profile?.municipality_id) return;
    setSubmitting(true);
    try {
      await createOrganizerRequest(String(user.id), profile.municipality_id, description.trim());
      toast.success("Žádost odeslána. Admin obce vás brzy schválí.");
      router.push("/profil");
    } catch {
      toast.error("Nepodařilo se odeslat žádost.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Stát se pořadatelem" back />
      <form onSubmit={submit} className="px-4 py-5 space-y-4">
        <p className="text-muted-foreground">
          Napište nám krátce, jaké akce byste chtěli ve Žďáru pořádat. Admin obce žádost schválí nebo zamítne.
        </p>
        <div>
          <Label htmlFor="d" className="text-base">Popis plánovaných aktivit *</Label>
          <Textarea id="d" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Např. Pravidelné setkání nad ručními pracemi pro seniorky každý čtvrtek v knihovně…"
            className="min-h-40 mt-1.5" />
        </div>
        <Button type="submit" disabled={submitting} className="w-full h-14 text-base font-semibold">
          Odeslat žádost
        </Button>
      </form>
    </div>
  );
}

export default function OrganizerRequestPage() {
  return (
    <RequireAuth>
      <OrganizerRequestContent />
    </RequireAuth>
  );
}
