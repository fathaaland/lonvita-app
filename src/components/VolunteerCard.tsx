"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, HandHeart, Mail, Pencil, Phone, X } from "lucide-react";
import { toast } from "sonner";
import {
  declinePoolInvitation,
  decideVolunteerInvitation,
  getMyPoolInvitations,
  getMyVolunteerInvitations,
  getMyVolunteerShifts,
  listMunicipalities,
  updateProfile,
  MyPoolInvitationRow,
  ProfileRow,
  VolunteerInvitationRow,
  VolunteerShiftRow,
} from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { MunicipalityPicker } from "@/components/map/MunicipalityPicker";
import type { MunicipalityMapPoint } from "@/components/map/MunicipalitiesMap";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/ConfirmActionButton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

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

export const focusLabel = (v: string) => VOLUNTEER_FOCUS_OPTIONS.find((o) => o.value === v)?.label ?? v;

type Draft = {
  /** The obec they help in — what puts them on the organizers' volunteer map. */
  municipalityId: string;
  focus: string[];
  note: string;
  allowEmail: boolean;
  email: string;
  allowPhone: boolean;
  phone: string;
};

/** What the form starts from — the volunteer's saved choices, or for a first sign-up their account
 * e-mail and profile phone, both offered as the channel. */
function draftFrom(profile: ProfileRow, accountEmail: string): Draft {
  const joinedBefore = Boolean(profile.volunteer_since) || profile.volunteer_allow_email || profile.volunteer_allow_phone;
  return {
    municipalityId: profile.volunteer_municipality_id ?? profile.municipality_id ?? "",
    focus: profile.volunteer_focus ?? [],
    note: profile.volunteer_note ?? "",
    allowEmail: joinedBefore ? profile.volunteer_allow_email : true,
    email: profile.volunteer_contact_email ?? accountEmail,
    allowPhone: joinedBefore ? profile.volunteer_allow_phone : Boolean(profile.phone),
    phone: profile.volunteer_contact_phone ?? profile.phone ?? "",
  };
}

/** Everything about the signed-in person's own place in the pool — the form's draft, joining or
 * saving, leaving, and what they're committed to (invitations, events they help on). Shared by the
 * profile (joining) and their volunteer card (editing, leaving). */
function useVolunteerPool() {
  const { user, profile, refreshProfile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [invitations, setInvitations] = useState<VolunteerInvitationRow[]>([]);
  const [shifts, setShifts] = useState<VolunteerShiftRow[]>([]);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  // An obec asking them to join (PoolInvitations) — they join through the form, or say no.
  const [poolInvitations, setPoolInvitations] = useState<MyPoolInvitationRow[]>([]);
  const [municipalities, setMunicipalities] = useState<MunicipalityMapPoint[]>([]);

  useEffect(() => {
    listMunicipalities()
      .then(setMunicipalities)
      .catch(() => setMunicipalities([]));
  }, []);

  useEffect(() => {
    setEditing(false);
  }, [profile?.id]);

  const inPool = Boolean(profile?.is_volunteer);
  const loadCommitments = async () => {
    if (!user) return;
    const uid = String(user.id);
    const [inv, sh, pool] = await Promise.all([
      getMyVolunteerInvitations(uid).catch(() => [] as VolunteerInvitationRow[]),
      getMyVolunteerShifts(uid).catch(() => [] as VolunteerShiftRow[]),
      getMyPoolInvitations(uid).catch(() => [] as MyPoolInvitationRow[]),
    ]);
    setInvitations(inv);
    setShifts(sh);
    setPoolInvitations(pool);
  };

  useEffect(() => {
    loadCommitments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, inPool]);

  const decide = async (invitation: VolunteerInvitationRow, accept: boolean) => {
    setDecidingId(invitation.id);
    try {
      await decideVolunteerInvitation(invitation.id, accept);
      toast.success(accept ? `Pomáháte na akci „${invitation.event_title}“.` : "Pozvánka odmítnuta.");
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Nepodařilo se uložit.");
    } finally {
      setDecidingId(null);
      await loadCommitments();
    }
  };

  /** `municipalityId` — accepting an obec's invitation starts with that obec as where they help. */
  const startEditing = (municipalityId?: string) => {
    if (!profile || !user) return;
    const base = draftFrom(profile, user.email);
    setDraft(municipalityId ? { ...base, municipalityId } : base);
    setEditing(true);
  };

  const declinePool = async (invitation: MyPoolInvitationRow) => {
    setDecidingId(invitation.id);
    try {
      await declinePoolInvitation(invitation.id);
      toast.success("Pozvánka odmítnuta.");
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Nepodařilo se uložit.");
    } finally {
      setDecidingId(null);
      await loadCommitments();
    }
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  /** Resolves true once saved. */
  const save = async (): Promise<boolean> => {
    if (!draft || !profile) return false;
    const problem = !draft.municipalityId
      ? "Vyberte na mapě obec, kde chcete pomáhat."
      : draft.focus.length === 0
        ? "Vyberte alespoň jednu oblast, ve které chcete pomoci."
        : !draft.allowEmail && !draft.allowPhone
          ? "Vyberte, jak vás mohou pořadatelé oslovit."
          : draft.allowEmail && !draft.email.trim()
            ? "Vyplňte kontaktní e-mail."
            : draft.allowPhone && !draft.phone.trim()
              ? "Vyplňte kontaktní telefon."
              : null;
    if (problem) {
      toast.error(problem);
      return false;
    }

    setSaving(true);
    try {
      await updateProfile(profile.id, {
        isVolunteer: true,
        volunteerMunicipality: Number(draft.municipalityId),
        volunteerFocus: draft.focus,
        volunteerNote: draft.note.trim().slice(0, 500) || null,
        volunteerAllowEmail: draft.allowEmail,
        volunteerContactEmail: draft.email.trim() || null,
        volunteerAllowPhone: draft.allowPhone,
        volunteerContactPhone: draft.phone.trim().slice(0, 40) || null,
      });
      await refreshProfile();
      toast.success(inPool ? "Uloženo." : "Jste v poolu dobrovolníků.");
      setEditing(false);
      return true;
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status === 400 ? error.message : "Nepodařilo se uložit.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** Resolves true once out of the pool. */
  const leave = async (): Promise<boolean> => {
    if (!profile) return false;
    setSaving(true);
    try {
      await updateProfile(profile.id, { isVolunteer: false });
      await refreshProfile();
      toast.success("Odešli jste z poolu dobrovolníků.");
      setEditing(false);
      return true;
    } catch {
      toast.error("Nepodařilo se odejít z poolu.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    user,
    profile,
    inPool,
    editing,
    setEditing,
    draft,
    set,
    saving,
    invitations,
    shifts,
    decidingId,
    poolInvitations,
    municipalities,
    decide,
    startEditing,
    declinePool,
    save,
    leave,
  };
}

/** Brief §7 "Přihlášení do poolu dobrovolníků" — one pool for the whole platform: whoever organizes
 * anywhere may reach out, only through the channels allowed here. On the profile it's the way in:
 * an invitation to join, then the form. Once in, the profile only leads to their volunteer card,
 * where they edit it or leave (VolunteerSelfPanel). */
export function VolunteerCard() {
  const pool = useVolunteerPool();
  const { user, profile, inPool, editing, draft, poolInvitations, decidingId } = pool;

  if (!profile || !user) return null;

  if (inPool && !editing) {
    const waiting = pool.invitations.length;
    return (
      <Button asChild variant="outline" className="w-full h-14 text-base">
        <Link href={`/dobrovolnik/${user.id}`}>
          <HandHeart className="h-5 w-5" /> Moje karta dobrovolníka
          {waiting > 0 && (
            <span
              className="ml-1 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground"
              aria-label={`Pozvánky k pomoci: ${waiting}`}
            >
              {waiting}
            </span>
          )}
        </Link>
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <HandHeart className="h-5 w-5 mt-0.5 shrink-0 text-primary" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="font-bold">Pool dobrovolníků</p>
            <p className="text-sm text-muted-foreground">
              Pořadatelé akcí vás budou moci oslovit, když budou potřebovat pomoc — jen tak, jak povolíte.
            </p>
          </div>
        </div>

        {!editing && poolInvitations.length > 0 && (
          <ul className="space-y-2">
            {poolInvitations.map((inv) => (
              <li key={inv.id} className="rounded-lg border border-primary/30 bg-primary-soft/40 p-3 space-y-2">
                <p className="text-sm font-semibold">Obec {inv.municipality_name} vás zve do poolu dobrovolníků.</p>
                {inv.message && <p className="text-sm text-muted-foreground">„{inv.message}“</p>}
                <div className="grid grid-cols-2 gap-2">
                  <Button className="h-10" disabled={decidingId === inv.id} onClick={() => pool.startEditing(inv.municipality_id)}>
                    Přidat se
                  </Button>
                  <Button variant="outline" className="h-10" disabled={decidingId === inv.id} onClick={() => pool.declinePool(inv)}>
                    Odmítnout
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {editing && draft && <VolunteerForm draft={draft} set={pool.set} municipalities={pool.municipalities} />}

        {editing ? (
          <div className="flex flex-col gap-2 pt-1">
            <Button className="w-full h-11" onClick={pool.save} disabled={pool.saving}>
              {pool.saving ? "Ukládám…" : inPool ? "Uložit změny" : "Přihlásit se do poolu"}
            </Button>
            <Button
              variant="ghost"
              className="w-full h-11 text-muted-foreground"
              onClick={() => pool.setEditing(false)}
              disabled={pool.saving}
            >
              Zrušit
            </Button>
          </div>
        ) : (
          poolInvitations.length === 0 && (
            <Button className="w-full h-11" onClick={() => pool.startEditing()}>
              Chci pomáhat
            </Button>
          )
        )}
      </CardContent>
    </Card>
  );
}

/** On their own volunteer card: invitations waiting for their answer, "Upravit" (the pool form) and
 * "Odejít z poolu". `onSaved` reloads the card; leaving takes them back to the profile — the card is
 * gone while they're out of the pool. */
export function VolunteerSelfPanel({ onSaved }: { onSaved: () => void }) {
  const router = useRouter();
  const pool = useVolunteerPool();
  const { inPool, editing, draft, invitations, shifts, saving } = pool;
  const [confirmLeave, setConfirmLeave] = useState(false);

  if (!pool.profile || !pool.user || !inPool) return null;

  return (
    <div className="space-y-4">
      {!editing && invitations.length > 0 && (
        <InvitationList invitations={invitations} decidingId={pool.decidingId} onDecide={pool.decide} />
      )}

      {editing && draft ? (
        <Card>
          <CardContent className="p-4 space-y-4">
            <VolunteerForm draft={draft} set={pool.set} municipalities={pool.municipalities} />
            <div className="flex flex-col gap-2 pt-1">
              <Button
                className="w-full h-11"
                disabled={saving}
                onClick={async () => {
                  if (await pool.save()) onSaved();
                }}
              >
                {saving ? "Ukládám…" : "Uložit změny"}
              </Button>
              <Button
                variant="ghost"
                className="w-full h-11 text-muted-foreground"
                onClick={() => pool.setEditing(false)}
                disabled={saving}
              >
                Zrušit
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="h-12 sm:flex-1" onClick={() => pool.startEditing()}>
            <Pencil className="h-4 w-4" /> Upravit
          </Button>
          <Button
            variant="outline"
            className="h-12 sm:flex-1 text-destructive hover:text-destructive"
            onClick={() => setConfirmLeave(true)}
          >
            Odejít z poolu
          </Button>
        </div>
      )}

      <AlertDialog open={confirmLeave} onOpenChange={(open) => !saving && setConfirmLeave(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Odejít z poolu dobrovolníků?</AlertDialogTitle>
            <AlertDialogDescription>
              Pořadatelé vás pak už nebudou moci oslovit. Vaše oblasti a kontakt si zapamatujeme, kdybyste se chtěli vrátit.
              {invitations.length > 0 && " Nevyřízené pozvánky se zruší."}
            </AlertDialogDescription>
            {shifts.length > 0 && (
              <div className="space-y-2 rounded-lg bg-muted px-3 py-2.5 text-sm">
                <p className="font-semibold">Na akcích, kde pomáháte, přestanete být dobrovolníkem:</p>
                <ul className="space-y-1.5">
                  {shifts.map((shift) => (
                    <li key={shift.registration_id}>
                      <span className="font-medium">{shift.title}</span>
                      <span className="text-muted-foreground">
                        {shift.full
                          ? " — akce je plná, z akce se odhlásíte."
                          : " — zůstanete na ní přihlášení jako účastník."}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground">Pořadatelé dostanou upozornění.</p>
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Zůstat</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                if (await pool.leave()) {
                  setConfirmLeave(false);
                  router.push("/profil");
                }
              }}
              disabled={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving ? "Odcházím…" : "Odejít z poolu"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const formatWhen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

/** Invitations from organizers still waiting for the volunteer's yes or no. */
function InvitationList({
  invitations,
  decidingId,
  onDecide,
}: {
  invitations: VolunteerInvitationRow[];
  decidingId: string | null;
  onDecide: (invitation: VolunteerInvitationRow, accept: boolean) => void;
}) {
  return (
    <section className="space-y-2" aria-label="Pozvánky k pomoci">
      <p className="text-sm font-semibold">Pozvánky k pomoci</p>
      {invitations.map((inv) => (
        <div key={inv.id} className="rounded-lg border-[1.5px] border-primary bg-primary-soft/40 p-3 space-y-2">
          <div>
            <Link href={`/akce/${inv.event_id}`} className="font-semibold hover:underline">
              {inv.event_title}
            </Link>
            <p className="text-xs text-muted-foreground">
              {formatWhen(inv.event_date_time)}
              {inv.event_location ? `, ${inv.event_location}` : ""} · zve {inv.invited_by_name}
            </p>
          </div>
          {inv.message && <p className="text-sm">„{inv.message}“</p>}
          <div className="grid grid-cols-2 gap-2">
            <ConfirmActionButton
              size="sm"
              className="h-10"
              disabled={decidingId === inv.id}
              title={`Pomáhat na akci „${inv.event_title}“?`}
              description={`${inv.invited_by_name} se dozví, že pozvánku přijímáte, a na akci budete zapsaní jako dobrovolník.`}
              confirmLabel="Pomůžu"
              onConfirm={() => onDecide(inv, true)}
            >
              <Check className="h-4 w-4" /> Pomůžu
            </ConfirmActionButton>
            <ConfirmActionButton
              size="sm"
              variant="outline"
              className="h-10"
              disabled={decidingId === inv.id}
              title={`Odmítnout pozvánku na akci „${inv.event_title}“?`}
              description={`${inv.invited_by_name} se dozví, že tentokrát pomoct nemůžete.`}
              confirmLabel="Nemůžu"
              onConfirm={() => onDecide(inv, false)}
            >
              <X className="h-4 w-4" /> Nemůžu
            </ConfirmActionButton>
          </div>
        </div>
      ))}
    </section>
  );
}

function VolunteerForm({
  draft,
  set,
  municipalities,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  municipalities: MunicipalityMapPoint[];
}) {
  const toggleFocus = (v: string) =>
    set("focus", draft.focus.includes(v) ? draft.focus.filter((x) => x !== v) : [...draft.focus, v]);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="vol-place">Kde chcete pomáhat</Label>
        <MunicipalityPicker
          id="vol-place"
          points={municipalities}
          value={{ id: draft.municipalityId, noMunicipality: false }}
          onChange={(choice) => set("municipalityId", choice.id)}
          requireMunicipality
          copy={{
            placeholder: "Vyberte obec na mapě",
            title: "Kde chcete pomáhat?",
            description: "Klepněte na tečku obce. Pořadatelé vás uvidí na mapě dobrovolníků právě tam.",
          }}
        />
      </div>

      <fieldset className="space-y-2.5">
        <legend className="text-sm font-semibold text-center w-full">S čím můžete pomoci</legend>
        <div className="flex flex-wrap justify-center gap-2">
          {VOLUNTEER_FOCUS_OPTIONS.map((o) => {
            const active = draft.focus.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={active}
                onClick={() => toggleFocus(o.value)}
                className={cn(
                  "h-10 rounded-full border-[1.5px] px-4 text-sm font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:border-brand-purple",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Jak vás mohou pořadatelé oslovit</legend>
        <p className="text-sm text-muted-foreground -mt-1">
          Aspoň jedna možnost. Pořadatelé uvidí jen kontakt, který tady povolíte.
        </p>
        <ContactChannel
          id="vol-email"
          icon={Mail}
          label="E-mailem"
          checked={draft.allowEmail}
          onCheckedChange={(v) => set("allowEmail", v)}
          value={draft.email}
          onValueChange={(v) => set("email", v)}
          type="email"
          placeholder="vas@email.cz"
        />
        <ContactChannel
          id="vol-phone"
          icon={Phone}
          label="Telefonem"
          checked={draft.allowPhone}
          onCheckedChange={(v) => set("allowPhone", v)}
          value={draft.phone}
          onValueChange={(v) => set("phone", v)}
          type="tel"
          placeholder="+420…"
        />
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="vol-note">Poznámka pro pořadatele (nepovinné)</Label>
        <Textarea
          id="vol-note"
          value={draft.note}
          onChange={(e) => set("note", e.target.value)}
          placeholder="Např. mám auto, mohu pomoci vozit lidi na akce…"
          maxLength={500}
          rows={3}
        />
      </div>
    </div>
  );
}

/** One way of being reached: the checkbox that allows it, and its contact — only editable while allowed. */
function ContactChannel({
  id,
  icon: Icon,
  label,
  checked,
  onCheckedChange,
  value,
  onValueChange,
  type,
  placeholder,
}: {
  id: string;
  icon: typeof Mail;
  label: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  value: string;
  onValueChange: (value: string) => void;
  type: "email" | "tel";
  placeholder: string;
}) {
  return (
    <div className={cn("rounded-lg border-[1.5px] p-3 space-y-2.5 transition-colors", checked ? "border-primary" : "border-border")}>
      <label htmlFor={`${id}-allow`} className="flex items-center gap-2.5 cursor-pointer text-sm font-semibold">
        <Checkbox id={`${id}-allow`} checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} />
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        {label}
      </label>
      {checked && (
        <Input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          maxLength={type === "email" ? 120 : 40}
          aria-label={`Kontakt — ${label.toLowerCase()}`}
          className="h-11"
        />
      )}
    </div>
  );
}
