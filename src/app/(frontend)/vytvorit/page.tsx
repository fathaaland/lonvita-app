"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getEventCategories,
  createEvent,
  getMyOrganizations,
  createOrganization,
  uploadEventImage,
  requestVolunteerFlag,
  getMunicipality,
  OrganizationRow,
} from "@/integrations/payload/queries";
import { LocationPicker } from "@/components/map/LocationPickerClient";
import type { PickedLocation } from "@/components/map/LocationPicker";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth, RequireRole } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { cn } from "@/lib/utils";

const ACCESSIBILITY_OPTIONS = [
  { value: "wheelchair_access", label: "Bezbariérový přístup" },
  { value: "induction_loop", label: "Indukční smyčka" },
  { value: "seating", label: "Možnost sezení" },
  { value: "accessible_wc", label: "WC pro invalidy" },
];

const WEEKDAYS = [
  { value: "mon", label: "Po" },
  { value: "tue", label: "Út" },
  { value: "wed", label: "St" },
  { value: "thu", label: "Čt" },
  { value: "fri", label: "Pá" },
  { value: "sat", label: "So" },
  { value: "sun", label: "Ne" },
];

const schema = z.object({
  title: z.string().trim().min(3, "Název musí mít alespoň 3 znaky").max(120),
  description: z.string().trim().min(10, "Popis musí mít alespoň 10 znaků").max(2000),
  date: z.string().min(1, "Vyberte datum"),
  time: z.string().min(1, "Vyberte čas"),
  endDate: z.string().optional(),
  endTime: z.string().optional(),
  capacity: z.coerce.number().int().min(1).max(1000),
  category_ids: z.array(z.string()).min(1, "Vyberte alespoň jednu kategorii"),
  priceCzk: z.coerce.number().min(0).optional(),
});

function CreateEventContent() {
  const router = useRouter();
  const { user, profile, isAdmin } = useAuth();
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationRow[]>([]);
  const [form, setForm] = useState({
    title: "", description: "", date: "", time: "", endDate: "", endTime: "",
    capacity: "10", priceCzk: "",
  });
  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [municipalityCenter, setMunicipalityCenter] = useState<[number, number]>([49.8175, 15.473]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [accessibilityTags, setAccessibilityTags] = useState<string[]>([]);
  const [isVolunteering, setIsVolunteering] = useState(false);
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurWeekdays, setRecurWeekdays] = useState<string[]>([]);
  const [approvalMode, setApprovalMode] = useState<"auto" | "manual">("manual");
  const [organizationId, setOrganizationId] = useState<string>("");
  const [isPaid, setIsPaid] = useState(false);
  const [imageId, setImageId] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const toggleInArray = (arr: string[], setArr: (v: string[]) => void, value: string) => {
    setArr(arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]);
  };

  useEffect(() => {
    getEventCategories().then(setCategories);
  }, []);

  useEffect(() => {
    if (user) getMyOrganizations(String(user.id)).then(setOrganizations);
  }, [user]);

  useEffect(() => {
    if (!profile?.municipality_id) return;
    getMunicipality(profile.municipality_id).then((m) => {
      if (m) setMunicipalityCenter([m.lat, m.lng]);
    });
  }, [profile?.municipality_id]);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImagePreview(URL.createObjectURL(file));
    setUploadingImage(true);
    try {
      const uploaded = await uploadEventImage(file, form.title || "Fotografie akce");
      setImageId(uploaded.id);
    } catch {
      toast.error("Nahrání fotografie se nepodařilo.");
      setImagePreview(null);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleAddOrganization = async () => {
    const name = window.prompt("Název organizace")?.trim();
    if (!name || !user) return;
    try {
      const org = await createOrganization(name, String(user.id));
      setOrganizations((prev) => [...prev, org]);
      setOrganizationId(org.id);
    } catch {
      toast.error("Nepodařilo se přidat organizaci.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ ...form, category_ids: categoryIds });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (!user || !profile?.municipality_id) return;
    if (!location) {
      toast.error("Vyberte místo konání na mapě.");
      return;
    }
    if (isMultiDay && (!parsed.data.endDate || !parsed.data.endTime)) {
      toast.error("Vyplňte datum a čas konce akce.");
      return;
    }

    setSubmitting(true);
    try {
      const dt = new Date(`${parsed.data.date}T${parsed.data.time}`);
      const endDt = isMultiDay && parsed.data.endDate && parsed.data.endTime
        ? new Date(`${parsed.data.endDate}T${parsed.data.endTime}`)
        : null;
      const recurrenceRule = isRecurring && recurWeekdays.length > 0
        ? `weekly:${recurWeekdays.join(",")}`
        : undefined;

      const created = await createEvent({
        title: parsed.data.title,
        description: parsed.data.description,
        dateTimeIso: dt.toISOString(),
        endDateTimeIso: endDt ? endDt.toISOString() : undefined,
        recurrenceRule,
        locationText: location.label,
        lat: location.lat,
        lng: location.lng,
        accessibilityTags,
        capacity: parsed.data.capacity,
        registrationApprovalMode: approvalMode,
        organizerUserId: String(user.id),
        municipalityId: profile.municipality_id,
        organizationId: organizationId || undefined,
        categoryIds: parsed.data.category_ids,
        imageId: imageId ?? undefined,
        // Only an admin can flip isVolunteering directly (brief §3) — a plain organizer's
        // checkbox instead fires a VolunteerFlagRequest right after creation, below.
        isVolunteering: isAdmin ? isVolunteering : false,
        isPaid,
        priceCents: isPaid && parsed.data.priceCzk ? Math.round(parsed.data.priceCzk * 100) : undefined,
      });

      if (isVolunteering && !isAdmin) {
        try {
          await requestVolunteerFlag(created.id, String(user.id));
          toast.success("Akce vytvořena, žádost o příznak Dobrovolnictví odeslána.");
        } catch {
          toast.success("Akce vytvořena.");
          toast.error("Žádost o příznak Dobrovolnictví se nepodařilo odeslat.");
        }
      } else {
        toast.success("Akce vytvořena!");
      }
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
          <Label className="text-base">Fotografie</Label>
          <label className="mt-1.5 flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-border bg-muted cursor-pointer">
            {imagePreview ? (
              <img src={imagePreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                <ImagePlus className="h-8 w-8" />
                <span className="text-sm font-medium">{uploadingImage ? "Nahrávám…" : "Nahrát fotografii"}</span>
              </div>
            )}
            <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} disabled={uploadingImage} />
          </label>
        </div>

        <div>
          <Label htmlFor="title" className="text-base">Název akce *</Label>
          <Input id="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="h-12 mt-1.5" />
        </div>
        <div>
          <Label className="text-base">Kategorie * <span className="font-normal text-muted-foreground">(vyberte jednu nebo víc)</span></Label>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {categories.map((c) => {
              const active = categoryIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleInArray(categoryIds, setCategoryIds, c.id)}
                  className={cn(
                    "px-3 py-2 rounded-full text-sm font-semibold border-[1.5px] transition-colors",
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-foreground border-border hover:border-brand-purple",
                  )}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <Label htmlFor="desc" className="text-base">Popis *</Label>
          <Textarea id="desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="min-h-32 mt-1.5" placeholder="O čem akce je, pro koho, co si vzít s sebou…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="date" className="text-base">Datum {isMultiDay ? "začátku" : ""} *</Label>
            <Input id="date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="h-12 mt-1.5" />
          </div>
          <div>
            <Label htmlFor="time" className="text-base">Čas {isMultiDay ? "začátku" : ""} *</Label>
            <Input id="time" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="h-12 mt-1.5" />
          </div>
        </div>

        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <Checkbox checked={isMultiDay} onCheckedChange={(v) => setIsMultiDay(v === true)} className="mt-0.5" />
          <span>Akce trvá víc dní.</span>
        </label>

        {isMultiDay && (
          <div className="grid grid-cols-2 gap-3 -mt-2">
            <div>
              <Label htmlFor="endDate" className="text-base">Datum konce *</Label>
              <Input id="endDate" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="h-12 mt-1.5" />
            </div>
            <div>
              <Label htmlFor="endTime" className="text-base">Čas konce *</Label>
              <Input id="endTime" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="h-12 mt-1.5" />
            </div>
          </div>
        )}

        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <Checkbox checked={isRecurring} onCheckedChange={(v) => setIsRecurring(v === true)} className="mt-0.5" />
          <span>Opakující se série (např. „každé úterý“).</span>
        </label>

        {isRecurring && (
          <div className="-mt-2">
            <Label className="text-sm text-muted-foreground">Opakuje se v tyto dny</Label>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {WEEKDAYS.map((d) => {
                const active = recurWeekdays.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleInArray(recurWeekdays, setRecurWeekdays, d.value)}
                    className={cn(
                      "h-10 w-10 rounded-full text-sm font-semibold border-[1.5px] transition-colors",
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-foreground border-border hover:border-brand-purple",
                    )}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <Label className="text-base">Místo konání *</Label>
          <div className="mt-1.5">
            <LocationPicker value={location} onChange={setLocation} initialCenter={municipalityCenter} />
          </div>
        </div>

        <div>
          <Label className="text-base">Přístupnost místa</Label>
          <div className="space-y-2 mt-1.5">
            {ACCESSIBILITY_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2.5 text-sm cursor-pointer">
                <Checkbox
                  checked={accessibilityTags.includes(opt.value)}
                  onCheckedChange={() => toggleInArray(accessibilityTags, setAccessibilityTags, opt.value)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="cap" className="text-base">Kapacita *</Label>
          <Input id="cap" type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} className="h-12 mt-1.5" />
        </div>

        <div>
          <Label className="text-base">Přihlašování účastníků</Label>
          <div className="flex gap-2 mt-1.5">
            {([
              { v: "manual" as const, label: "S potvrzením organizátora" },
              { v: "auto" as const, label: "Bez schvalování" },
            ]).map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setApprovalMode(opt.v)}
                className={cn(
                  "flex-1 h-11 rounded-lg text-sm font-semibold border-[1.5px] transition-colors",
                  approvalMode === opt.v
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-foreground border-border hover:border-brand-purple",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-base">Organizace <span className="font-normal text-muted-foreground">(nepovinné)</span></Label>
          <div className="flex gap-2 mt-1.5">
            <Select value={organizationId} onValueChange={setOrganizationId}>
              <SelectTrigger className="h-12 flex-1"><SelectValue placeholder="Vlastní jméno" /></SelectTrigger>
              <SelectContent>
                {organizations.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" className="h-12" onClick={handleAddOrganization}>+ Nová</Button>
          </div>
        </div>

        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <Checkbox checked={isVolunteering} onCheckedChange={(v) => setIsVolunteering(v === true)} className="mt-0.5" />
          <span>
            {isAdmin
              ? "Tohle je dobrovolnická aktivita."
              : "Tohle je dobrovolnická aktivita — po vytvoření požádám obec o schválení příznaku."}
          </span>
        </label>

        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <Checkbox checked={isPaid} onCheckedChange={(v) => setIsPaid(v === true)} className="mt-0.5" />
          <span>Placená akce.</span>
        </label>

        {isPaid && (
          <div>
            <Label htmlFor="price" className="text-base">Cena (Kč) *</Label>
            <Input id="price" type="number" min="0" value={form.priceCzk} onChange={(e) => setForm({ ...form, priceCzk: e.target.value })} className="h-12 mt-1.5" />
            <p className="text-sm text-muted-foreground mt-1.5">
              Platbu si s účastníky domlouváte sami mimo aplikaci — Lonvita platby nezpracovává.
            </p>
          </div>
        )}

        <Button type="submit" disabled={submitting || uploadingImage} className="w-full h-14 text-base font-semibold">
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
