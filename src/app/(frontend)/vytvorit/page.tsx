"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getEventCategories, createEvent } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth, RequireRole } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { z } from "zod";

const schema = z.object({
  title: z.string().trim().min(3, "Název musí mít alespoň 3 znaky").max(120),
  description: z.string().trim().min(10, "Popis musí mít alespoň 10 znaků").max(2000),
  date: z.string().min(1, "Vyberte datum"),
  time: z.string().min(1, "Vyberte čas"),
  location_text: z.string().trim().min(3, "Zadejte místo").max(200),
  capacity: z.coerce.number().int().min(1).max(1000),
  category_id: z.string().min(1, "Vyberte kategorii"),
});

function CreateEventContent() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    title: "", description: "", date: "", time: "",
    location_text: "", capacity: "10", category_id: "",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getEventCategories().then(setCategories);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (!user || !profile?.municipality_id) return;

    setSubmitting(true);
    try {
      const dt = new Date(`${parsed.data.date}T${parsed.data.time}`);
      await createEvent({
        title: parsed.data.title,
        description: parsed.data.description,
        dateTimeIso: dt.toISOString(),
        locationText: parsed.data.location_text,
        capacity: parsed.data.capacity,
        organizerUserId: String(user.id),
        municipalityId: profile.municipality_id,
        categoryId: parsed.data.category_id,
      });
      toast.success("Akce vytvořena!");
      router.push("/");
    } catch {
      toast.error("Nepodařilo se vytvořit akci. Zkontrolujte oprávnění.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Vytvořit akci" back />
      <form onSubmit={handleSubmit} className="px-4 py-5 space-y-4">
        <div>
          <Label htmlFor="title" className="text-base">Název akce *</Label>
          <Input id="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="h-12 mt-1.5" />
        </div>
        <div>
          <Label htmlFor="category" className="text-base">Kategorie *</Label>
          <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
            <SelectTrigger className="h-12 mt-1.5"><SelectValue placeholder="Vyberte kategorii" /></SelectTrigger>
            <SelectContent>
              {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="desc" className="text-base">Popis *</Label>
          <Textarea id="desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="min-h-32 mt-1.5" placeholder="O čem akce je, pro koho, co si vzít s sebou…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="date" className="text-base">Datum *</Label>
            <Input id="date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="h-12 mt-1.5" />
          </div>
          <div>
            <Label htmlFor="time" className="text-base">Čas *</Label>
            <Input id="time" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="h-12 mt-1.5" />
          </div>
        </div>
        <div>
          <Label htmlFor="loc" className="text-base">Místo *</Label>
          <Input id="loc" value={form.location_text} onChange={(e) => setForm({ ...form, location_text: e.target.value })}
            className="h-12 mt-1.5" placeholder="např. Náměstí Republiky, Žďár nad Sázavou" />
        </div>
        <div>
          <Label htmlFor="cap" className="text-base">Kapacita *</Label>
          <Input id="cap" type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} className="h-12 mt-1.5" />
        </div>

        <p className="text-sm text-muted-foreground">
          Placené akce zatím nejsou podporované — všechny akce jsou zdarma.
        </p>

        <Button type="submit" disabled={submitting} className="w-full h-14 text-base font-semibold">
          Vytvořit akci
        </Button>
      </form>
    </div>
  );
}

export default function CreateEventPage() {
  return (
    <RequireAuth>
      <RequireRole role="organizer">
        <CreateEventContent />
      </RequireRole>
    </RequireAuth>
  );
}
