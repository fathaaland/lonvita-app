"use client";

import { useEffect, useState } from "react";
import { getEventCategories, uploadEventImage, EventRow, OrganizationRef } from "@/integrations/payload/queries";
import { LocationPicker } from "@/components/map/LocationPickerClient";
import type { PickedLocation } from "@/components/map/LocationPicker";
import { CoOrganizerPicker } from "@/components/CoOrganizerPicker";
import { ImagePositionEditor, CENTERED_IMAGE_POSITION, ImagePosition } from "@/components/ImagePositionEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { ImageUploadError, prepareImageForUpload } from "@/lib/image";
import { toDateInputValue } from "@/lib/date";
import { UNLIMITED_CAPACITY, isUnlimitedCapacity } from "@/lib/capacity";

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
  capacity: z.coerce.number().int().min(1).max(UNLIMITED_CAPACITY),
  category_ids: z.array(z.string()).min(1, "Vyberte alespoň jednu kategorii"),
  priceCzk: z.coerce.number().min(0).optional(),
});

export type EventFormValues = {
  title: string;
  description: string;
  dateTimeIso: string;
  endDateTimeIso: string | null;
  recurrenceRule: string | null;
  location: PickedLocation;
  accessibilityTags: string[];
  capacity: number;
  registrationApprovalMode: "auto" | "manual";
  categoryIds: string[];
  /** Only set when a new photo was uploaded in this form — otherwise the event keeps its photo. */
  imageId: string | null;
  /** Which part of the photo the 16:10 crop shows (cards, detail). */
  imagePosition: ImagePosition;
  isVolunteering: boolean;
  isPaid: boolean;
  priceCents: number | null;
  coOrganizationIds: string[];
  isHidden: boolean;
};

const toLocalTime = (iso: string) => new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });

const chipClass = (active: boolean) =>
  cn(
    "px-3 py-2 rounded-full text-sm font-semibold border-[1.5px] transition-colors",
    active
      ? "bg-primary text-primary-foreground border-primary"
      : "bg-card text-foreground border-border hover:border-brand-purple",
  );

interface Props {
  userId: string;
  /** Present when editing an existing event — prefills every field. */
  initial?: EventRow;
  municipalityId: string;
  municipalityCenter: [number, number];
  /** A platform/municipality admin sets the volunteering flag directly; others request it. */
  canSetVolunteering: boolean;
  submitLabel: string;
  /** Handles its own success/error toasts; the form only tracks the submitting state. */
  onSubmit: (values: EventFormValues) => Promise<void>;
}

/** The event create/edit form (brief §4 "Vytvoření akce" + organizer self-service edit). */
export function EventForm({ userId, initial, municipalityId, municipalityCenter, canSetVolunteering, submitLabel, onSubmit }: Props) {
  const initialWeekdays = initial?.recurrence_rule?.startsWith("weekly:")
    ? initial.recurrence_rule.slice("weekly:".length).split(",").filter(Boolean)
    : [];

  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    date: initial ? toDateInputValue(initial.date_time) : "",
    time: initial ? toLocalTime(initial.date_time) : "",
    endDate: initial?.end_date_time ? toDateInputValue(initial.end_date_time) : "",
    endTime: initial?.end_date_time ? toLocalTime(initial.end_date_time) : "",
    capacity: String(initial?.capacity ?? 10),
    priceCzk: initial?.price_cents ? String(initial.price_cents / 100) : "",
  });
  const [location, setLocation] = useState<PickedLocation | null>(
    initial && initial.lat != null && initial.lng != null
      ? { lat: initial.lat, lng: initial.lng, label: initial.location_text }
      : null,
  );
  const [categoryIds, setCategoryIds] = useState<string[]>(initial?.category_ids ?? []);
  const [accessibilityTags, setAccessibilityTags] = useState<string[]>(initial?.accessibility_tags ?? []);
  const [isVolunteering, setIsVolunteering] = useState(Boolean(initial?.is_volunteering));
  const [isMultiDay, setIsMultiDay] = useState(Boolean(initial?.end_date_time));
  const [isRecurring, setIsRecurring] = useState(initialWeekdays.length > 0);
  const [recurWeekdays, setRecurWeekdays] = useState<string[]>(initialWeekdays);
  const [approvalMode, setApprovalMode] = useState<"auto" | "manual">(initial?.registration_approval_mode ?? "manual");
  const [coOrganizations, setCoOrganizations] = useState<OrganizationRef[]>(initial?.co_organizations ?? []);
  const [unlimitedCapacity, setUnlimitedCapacity] = useState(isUnlimitedCapacity(initial?.capacity ?? 0));
  const [isPaid, setIsPaid] = useState(Boolean(initial?.is_paid));
  const [isHidden, setIsHidden] = useState(Boolean(initial?.is_hidden));
  const [imageId, setImageId] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(initial?.image_url ?? null);
  const [imagePosition, setImagePosition] = useState<ImagePosition>(initial?.image_position ?? CENTERED_IMAGE_POSITION);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const volunteeringLocked = !canSetVolunteering && Boolean(initial?.is_volunteering);

  const toggleInArray = (arr: string[], setArr: (v: string[]) => void, value: string) => {
    setArr(arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]);
  };

  useEffect(() => {
    getEventCategories().then(setCategories);
  }, []);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again (e.g. after a failed upload) still fires onChange.
    e.target.value = "";
    if (!file) return;
    setImagePreview(URL.createObjectURL(file));
    // A different photo needs its own framing — start from the centre.
    setImagePosition(CENTERED_IMAGE_POSITION);
    setUploadingImage(true);
    try {
      const prepared = await prepareImageForUpload(file);
      const uploaded = await uploadEventImage(prepared, form.title || "Fotografie akce");
      setImageId(uploaded.id);
    } catch (error) {
      toast.error(error instanceof ImageUploadError ? error.message : "Nahrání fotografie se nepodařilo.");
      setImageId(null);
      setImagePreview(initial?.image_url ?? null);
      setImagePosition(initial?.image_position ?? CENTERED_IMAGE_POSITION);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ ...form, category_ids: categoryIds });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (!location) {
      toast.error("Vyberte místo konání na mapě.");
      return;
    }
    if (isMultiDay && (!parsed.data.endDate || !parsed.data.endTime)) {
      toast.error("Vyplňte datum a čas konce akce.");
      return;
    }

    const startsAt = new Date(`${parsed.data.date}T${parsed.data.time}`);
    // Editing an event that already started is fine as long as its start isn't moved.
    const startChanged = !initial || startsAt.getTime() !== new Date(toDateInputValue(initial.date_time) + "T" + toLocalTime(initial.date_time)).getTime();
    if (startChanged && startsAt.getTime() < Date.now()) {
      toast.error("Akce nemůže začínat v minulosti.");
      return;
    }
    const endsAt = isMultiDay ? new Date(`${parsed.data.endDate}T${parsed.data.endTime}`) : null;
    if (endsAt && endsAt.getTime() < startsAt.getTime()) {
      toast.error("Konec akce nemůže být dřív než její začátek.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        title: parsed.data.title,
        description: parsed.data.description,
        // Unchanged start keeps the stored instant exactly (seconds included).
        dateTimeIso: startChanged || !initial ? startsAt.toISOString() : initial.date_time,
        endDateTimeIso: endsAt ? endsAt.toISOString() : null,
        recurrenceRule: isRecurring && recurWeekdays.length > 0 ? `weekly:${recurWeekdays.join(",")}` : null,
        location,
        accessibilityTags,
        capacity: parsed.data.capacity,
        registrationApprovalMode: approvalMode,
        coOrganizationIds: coOrganizations.map((c) => c.id),
        categoryIds: parsed.data.category_ids,
        imageId,
        imagePosition,
        isVolunteering,
        isPaid,
        priceCents: isPaid && parsed.data.priceCzk ? Math.round(parsed.data.priceCzk * 100) : null,
        isHidden,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const today = toDateInputValue();
  // Editing used to leave the date picker's `min` unset entirely, so an organizer/admin could
  // pick a brand-new past date for an *upcoming* event — a selection that then silently failed
  // at submit time (handleSubmit's startChanged/past-date check above). Only lift the floor when
  // the event's own original date is already in the past (so its existing value stays pickable).
  const originalEventIsPast = !!initial && new Date(initial.date_time).getTime() < Date.now();

  return (
    <form onSubmit={handleSubmit} className="px-4 py-5 space-y-4">
      <div>
        <Label className="text-base">Fotografie</Label>
        {imagePreview ? (
          <div className="mt-1.5 space-y-2">
            <ImagePositionEditor
              src={imagePreview}
              value={imagePosition}
              onChange={setImagePosition}
              className="aspect-[16/10] w-full sm:mx-auto sm:w-[calc(100%_-_2rem)] sm:max-w-3xl"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Tento výřez uvidí účastníci v přehledu akcí i na detailu.</p>
              <label className={cn("shrink-0 text-sm font-semibold text-primary", uploadingImage ? "opacity-70" : "cursor-pointer hover:underline")}>
                {uploadingImage ? "Nahrávám…" : "Změnit fotografii"}
                <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} disabled={uploadingImage} />
              </label>
            </div>
          </div>
        ) : (
          <label className="mt-1.5 flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-border bg-muted cursor-pointer sm:mx-auto sm:w-[calc(100%_-_2rem)] sm:max-w-3xl">
            <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
              <ImagePlus className="h-8 w-8" />
              <span className="text-sm font-medium">{uploadingImage ? "Nahrávám…" : "Nahrát fotografii"}</span>
            </div>
            <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} disabled={uploadingImage} />
          </label>
        )}
      </div>

      <div>
        <Label htmlFor="title" className="text-base">Název akce *</Label>
        <Input id="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="h-12 mt-1.5" />
      </div>
      <div>
        <Label className="text-base">Kategorie * <span className="font-normal text-muted-foreground">(vyberte jednu nebo víc)</span></Label>
        <div className="flex flex-wrap gap-2 mt-1.5">
          {categories.map((c) => (
            <button key={c.id} type="button" onClick={() => toggleInArray(categoryIds, setCategoryIds, c.id)} className={chipClass(categoryIds.includes(c.id))}>
              {c.name}
            </button>
          ))}
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
          <Input id="date" type="date" min={originalEventIsPast ? undefined : today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="h-12 mt-1.5" />
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
            <Input id="endDate" type="date" min={form.date || (originalEventIsPast ? undefined : today)} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="h-12 mt-1.5" />
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
        <Input
          id="cap"
          type="number"
          min="1"
          max={UNLIMITED_CAPACITY - 1}
          disabled={unlimitedCapacity}
          value={unlimitedCapacity ? "" : form.capacity}
          placeholder={unlimitedCapacity ? "Neomezená" : undefined}
          onChange={(e) => setForm({ ...form, capacity: e.target.value })}
          className="h-12 mt-1.5 disabled:opacity-60"
        />
        <label className="flex items-center gap-2.5 text-sm cursor-pointer mt-2">
          <Checkbox
            checked={unlimitedCapacity}
            onCheckedChange={(v) => {
              const on = v === true;
              setUnlimitedCapacity(on);
              // Remember what was typed so unchecking restores it instead of leaving "999999".
              setForm((f) => ({ ...f, capacity: on ? String(UNLIMITED_CAPACITY) : f.capacity === String(UNLIMITED_CAPACITY) ? "10" : f.capacity }));
            }}
          />
          <span>Neomezená kapacita.</span>
        </label>
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
        <Label className="text-base">Spolupořadatelé <span className="font-normal text-muted-foreground">(nepovinné)</span></Label>
        <p className="text-sm text-muted-foreground mt-0.5 mb-1.5">
          Organizace pořadatelů této obce — podnik, spolek nebo jednotlivec. Akce se jim objeví v jejich přehledu
          akcí a mohou ji spravovat. Akci založenou obcí upravuje a maže už jen obec. Akci s další organizací
          smažete jen s jejím souhlasem.
        </p>
        <CoOrganizerPicker
          municipalityId={municipalityId}
          value={coOrganizations}
          onChange={setCoOrganizations}
          excludeIds={initial?.organization ? [initial.organization.id] : []}
          // Only the obec admin removes another organization; an organizer can only take their own
          // off (Events guardCoOrganizedChanges).
          fixedIds={
            initial && !canSetVolunteering
              ? initial.co_organizations.filter((o) => o.owner_id !== userId).map((o) => o.id)
              : []
          }
        />
      </div>

      <label className={cn("flex items-start gap-2.5 text-sm", volunteeringLocked ? "opacity-70" : "cursor-pointer")}>
        <Checkbox
          checked={isVolunteering}
          disabled={volunteeringLocked}
          onCheckedChange={(v) => setIsVolunteering(v === true)}
          className="mt-0.5"
        />
        <span>
          {canSetVolunteering
            ? "Tohle je dobrovolnická aktivita."
            : volunteeringLocked
              ? "Dobrovolnická aktivita (příznak schválen obcí)."
              : `Tohle je dobrovolnická aktivita — po ${initial ? "uložení" : "vytvoření"} požádám obec o schválení příznaku.`}
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

      {initial && (
        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <Checkbox checked={isHidden} onCheckedChange={(v) => setIsHidden(v === true)} className="mt-0.5" />
          <span>
            Pozastavit zobrazení akce <span className="font-normal text-muted-foreground">— zmizí z veřejného přehledu a mapy, přihlášení účastníci a data zůstanou zachovaní.</span>
          </span>
        </label>
      )}

      <Button type="submit" disabled={submitting || uploadingImage} className="w-full h-14 text-base font-semibold">
        {submitLabel}
      </Button>
    </form>
  );
}
