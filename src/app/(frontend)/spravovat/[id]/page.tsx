"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  getEvent,
  getEventRegistrationsForManage,
  updateRegistrationStatus,
  updateAttendance,
  getOrganizerName,
  getVolunteerRatingsForEvent,
  getEventReliability,
  ManageRegistrationRow,
  AttendanceStatus,
  VolunteerRatingRow,
} from "@/integrations/payload/queries";
import { RateVolunteer } from "@/components/RateVolunteer";
import { ReliabilityBadge } from "@/components/ReliabilityBadge";
import { NO_SHOW_LIMIT, RELIABILITY_WINDOW_MONTHS, type ReliabilityRecord } from "@/lib/reliability";
import { VolunteerOffers } from "@/components/VolunteerOffers";
import { EventMessageCard } from "@/components/EventMessageCard";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth, RequireRole } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Check, X, Clock, UserCheck, UserX, UserMinus, CalendarOff, HandHeart, Undo2 } from "lucide-react";
import { isRegistrationOpen } from "@/lib/registrationCutoff";
import { hasEventEnded } from "@/lib/eventEnded";
import { PayloadApiError } from "@/integrations/payload/client";
import { cn } from "@/lib/utils";
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
import { isUnlimitedCapacity } from "@/lib/capacity";
import { isPast } from "@/lib/date";
import { toast } from "sonner";

const ATTENDANCE_OPTIONS: { value: AttendanceStatus; label: string; icon: typeof UserCheck }[] = [
  { value: "attended", label: "Přišel/a", icon: UserCheck },
  { value: "no_show", label: "Nedorazil/a", icon: UserX },
  { value: "excused", label: "Omluven/a", icon: CalendarOff },
];

function ManageEventContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user, administeredMunicipalityIds } = useAuth();
  const [regs, setRegs] = useState<ManageRegistrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [organizerName, setOrganizerName] = useState<string | null>(null);
  const [coOrganizerNames, setCoOrganizerNames] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  // Attendance, the volunteers and their ratings are the pořadatel who founded the event's alone —
  // not its spolupořadatelé, not the obec co-organizing it (Registrations canMarkAttendance).
  const [isCreator, setIsCreator] = useState(false);
  // An event with unlimited capacity keeps no attendance — its volunteers are rated straight away.
  const [unlimited, setUnlimited] = useState(false);
  // Attendance picked on the page but not yet confirmed — nothing reaches the participant
  // (and nobody can rate the event) until "Potvrdit docházku" saves it, for good.
  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [volunteerRatings, setVolunteerRatings] = useState<Map<string, VolunteerRatingRow>>(new Map());
  // An approved participant the pořadatel (or any spolupořadatel) is about to take off the event —
  // a volunteer only the pořadatel who founded it (Registrations guardStatusChange).
  const [removing, setRemoving] = useState<ManageRegistrationRow | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  // A pending registration about to be turned down — asked first: it can't be signed up again
  // unless the decision is taken back ("Povolit znovu").
  const [rejecting, setRejecting] = useState<ManageRegistrationRow | null>(null);
  const [rejectBusy, setRejectBusy] = useState(false);
  // How reliably each participant turns up (lib/reliability), by user id.
  const [reliability, setReliability] = useState<Map<string, ReliabilityRecord>>(new Map());
  // A participant's confirmed attendance is the pořadatel's for good — only the obec's admin corrects
  // a mistake, which would otherwise count against them (Registrations lockAttendanceOnceMarked).
  const [canCorrect, setCanCorrect] = useState(false);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correction, setCorrection] = useState<{ reg: ManageRegistrationRow; status: AttendanceStatus } | null>(null);
  const [correctBusy, setCorrectBusy] = useState(false);

  const load = async () => {
    if (!id) return;
    const [ev, rows, ratings, records] = await Promise.all([
      getEvent(id),
      getEventRegistrationsForManage(id),
      getVolunteerRatingsForEvent(id).catch(() => new Map<string, VolunteerRatingRow>()),
      getEventReliability(id).catch(() => new Map<string, ReliabilityRecord>()),
    ]);
    setRegs(rows);
    setVolunteerRatings(ratings);
    setReliability(records);
    setLoading(false);
    if (ev) {
      setStartsAt(ev.date_time);
      setEnded(hasEventEnded(ev.date_time, ev.end_date_time));
      setUnlimited(isUnlimitedCapacity(ev.capacity));
      setIsCreator(Boolean(user) && ev.organizer_id === String(user!.id));
      setCanCorrect(Boolean(ev.municipality_id) && administeredMunicipalityIds.includes(ev.municipality_id!));
      const orgName = ev.organization
        ? ev.organization.name
        : ev.organizer_id
          ? await getOrganizerName(ev.organizer_id).catch(() => null)
          : null;
      setOrganizerName(orgName);
      setCoOrganizerNames(ev.co_organizations.map((o) => o.name));
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const approve = async (regId: string) => {
    try {
      await updateRegistrationStatus(regId, "approved");
      toast.success("Schváleno.");
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Nepodařilo se uložit změnu.");
    }
    load();
  };

  const reject = async () => {
    if (!rejecting) return;
    setRejectBusy(true);
    try {
      await updateRegistrationStatus(rejecting.id, "rejected");
      toast.success("Přihláška zamítnuta.");
      setRejecting(null);
      load();
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Nepodařilo se uložit změnu.");
    } finally {
      setRejectBusy(false);
    }
  };

  /** Takes back a rejection or a removal: the registration is set aside as cancelled, which no longer
   * blocks signing up — they decide themselves whether to come after all, and are told they may. */
  const allowAgain = async (reg: ManageRegistrationRow) => {
    try {
      await updateRegistrationStatus(reg.id, "cancelled");
      toast.success(`${reg.full_name} se může znovu ${reg.role === "volunteer" ? "nabídnout" : "přihlásit"}.`);
      load();
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Nepodařilo se uložit změnu.");
    }
  };

  const removeFromEvent = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await updateRegistrationStatus(removing.id, "rejected");
      toast.success(`${removing.full_name} už na akci není.`);
      setRemoving(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nepodařilo se uložit změnu.");
    } finally {
      setRemoveBusy(false);
    }
  };

  const pickAttendance = (reg: ManageRegistrationRow, status: AttendanceStatus) => {
    setDraft((prev) => {
      const next = { ...prev };
      // Clicking the picked option again drops it.
      if (prev[reg.id] === status) delete next[reg.id];
      else next[reg.id] = status;
      return next;
    });
  };

  const confirmAttendance = async () => {
    const changes = Object.entries(draft);
    setConfirming(true);
    const results = await Promise.allSettled(changes.map(([regId, status]) => updateAttendance(regId, status)));
    setConfirming(false);
    setConfirmOpen(false);
    const failed = changes.filter((_, i) => results[i].status === "rejected");
    setDraft(Object.fromEntries(failed));
    await load();
    if (failed.length) {
      toast.error(`Docházku se nepodařilo uložit u ${failed.length} ${failed.length === 1 ? "účastníka" : "účastníků"}. Zkuste to znovu.`);
    } else {
      toast.success(
        changes.some(([, status]) => status === "attended")
          ? "Docházka potvrzena. Kdo přišel, dostane žádost o ohodnocení akce."
          : "Docházka potvrzena.",
      );
    }
  };

  const correctAttendance = async () => {
    if (!correction) return;
    setCorrectBusy(true);
    try {
      await updateAttendance(correction.reg.id, correction.status);
      toast.success("Docházka opravena.");
      setCorrection(null);
      setCorrectingId(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Docházku se nepodařilo opravit.");
    } finally {
      setCorrectBusy(false);
    }
  };

  const started = startsAt !== null && isPast(startsAt);
  // Sign-up closes REGISTRATION_CUTOFF_HOURS before the start — after that the participant couldn't
  // sign up again anyway, so a rejection isn't worth taking back.
  const signUpOpen = startsAt !== null && isRegistrationOpen(startsAt);
  const hasApproved = regs.some((r) => r.status === "approved");
  const unmarked = regs.filter((r) => r.status === "approved" && r.attendance_status === "not_marked");
  const changeCount = Object.keys(draft).length;
  const draftCount = (status: AttendanceStatus) => Object.values(draft).filter((s) => s === status).length;

  if (loading) return <><PageHeader title="Přihlášení" back /><Loading /></>;

  return (
    <div className="animate-fade-in sm:mx-auto sm:max-w-3xl">
      <PageHeader title="Přihlášení" subtitle={`Celkem: ${regs.length}`} back />
      <div className="px-4 py-5 space-y-3">
        {(organizerName || coOrganizerNames.length > 0) && (
          <p className="text-sm text-muted-foreground">
            {organizerName && <>Pořadatel: {organizerName}</>}
            {coOrganizerNames.length > 0 && <> · spolu s {coOrganizerNames.join(", ")}</>}
          </p>
        )}
        {!ended && regs.some((r) => r.status === "pending" || r.status === "approved") && <EventMessageCard eventId={id} />}
        {!started && <VolunteerOffers eventId={id} canDecide={isCreator} onDecided={load} />}
        {regs.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Zatím nikdo není přihlášen.</p>
        ) : regs.map((r) => (
          <Card key={r.id}><CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <UserAvatar
                name={r.full_name}
                src={r.avatar_url}
                className="h-10 w-10"
                fallbackClassName="bg-primary text-primary-foreground"
              />
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">{r.full_name}</p>
                {r.phone && <p className="text-sm text-muted-foreground">{r.phone}</p>}
              </div>
              {r.role === "volunteer" && r.status === "approved" ? (
                <Badge className="bg-primary-soft text-brand-purple-dark gap-1"><HandHeart className="h-3 w-3" />Dobrovolník</Badge>
              ) : r.status === "approved" && <Badge className="bg-success text-success-foreground">Schválen</Badge>}
              {r.status === "pending" &&
                (ended ? (
                  <Badge variant="outline">Nevyřízeno</Badge>
                ) : (
                  <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />Čeká</Badge>
                ))}
              {r.status === "rejected" && <Badge variant="destructive">Zamítnut</Badge>}
              {r.status === "cancelled" && (
                <Badge variant="outline">{r.role === "volunteer" ? "Zrušeno dobrovolníkem" : "Zrušeno účastníkem"}</Badge>
              )}
            </div>

            {r.role !== "volunteer" && r.user_id !== String(user?.id) && reliability.get(r.user_id) && (
              <ReliabilityBadge record={reliability.get(r.user_id)!} />
            )}

            {r.status === "cancelled" && r.excuse_message && (
              <p className="text-sm whitespace-pre-line"><span className="font-semibold">Omluvenka:</span> „{r.excuse_message}“</p>
            )}

            {/* Signed up as themselves (an obec's admin on a club's event) — the pořadatel decides. */}
            {r.user_id === String(user?.id) && !started && (r.status === "pending" || r.status === "approved") && (
              <p className="text-sm text-muted-foreground">
                Vaše vlastní přihláška — rozhoduje o ní pořadatel akce. Zrušit ji můžete na stránce akce.
              </p>
            )}

            {r.status === "pending" && r.user_id !== String(user?.id) && !ended && (
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => approve(r.id)} className="h-11"><Check className="h-4 w-4" />Schválit</Button>
                <Button onClick={() => setRejecting(r)} variant="outline" className="h-11">
                  <X className="h-4 w-4" />Zamítnout
                </Button>
              </div>
            )}

            {r.status === "rejected" && signUpOpen && (r.role !== "volunteer" || isCreator) && (
              <Button onClick={() => allowAgain(r)} variant="ghost" className="h-11 w-full">
                <Undo2 className="h-4 w-4" />Povolit znovu {r.role === "volunteer" ? "nabídnout pomoc" : "přihlásit se"}
              </Button>
            )}

            {r.status === "approved" && !started && r.role === "volunteer" && !isCreator && r.user_id !== String(user?.id) && (
              <p className="text-sm text-muted-foreground">
                O dobrovolnících rozhoduje jen pořadatel, který akci založil.
              </p>
            )}

            {r.status === "approved" && !started && (r.role !== "volunteer" || isCreator) && r.user_id !== String(user?.id) && (
              <Button
                onClick={() => setRemoving(r)}
                variant="outline"
                className="h-11 w-full text-destructive hover:text-destructive"
              >
                <UserMinus className="h-4 w-4" />Odebrat z akce
              </Button>
            )}

            {r.status === "approved" && started && !unlimited && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground">Docházka</p>
                {r.attendance_status !== "not_marked" ? (
                  // Confirmed — final, but for a correction by the obec's admin.
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <AttendanceResult status={r.attendance_status} />
                      {canCorrect && r.role !== "volunteer" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setCorrectingId(correctingId === r.id ? null : r.id)}
                          aria-expanded={correctingId === r.id}
                        >
                          Opravit
                        </Button>
                      )}
                    </div>
                    {correctingId === r.id && (
                      <div className="grid grid-cols-2 gap-2">
                        {ATTENDANCE_OPTIONS.filter((o) => o.value !== r.attendance_status).map(({ value, label, icon: Icon }) => (
                          <Button
                            key={value}
                            variant="outline"
                            className="h-11 text-xs px-1"
                            onClick={() => setCorrection({ reg: r, status: value })}
                          >
                            <Icon className="h-4 w-4" />{label}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : isCreator ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {ATTENDANCE_OPTIONS.map(({ value, label, icon: Icon }) => {
                        const active = draft[r.id] === value;
                        return (
                          <Button
                            key={value}
                            onClick={() => pickAttendance(r, value)}
                            variant={active ? "default" : "outline"}
                            aria-pressed={active}
                            className={cn("h-11 text-xs px-1", active && value === "no_show" && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
                          >
                            <Icon className="h-4 w-4" />{label}
                          </Button>
                        );
                      })}
                    </div>
                    {draft[r.id] && <p className="text-xs text-warning-foreground">Neuloženo</p>}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Zatím nevyplněno — docházku zapíše pořadatel, který akci založil.</p>
                )}
              </div>
            )}

            {/* A volunteer who came is rated by the pořadatel — it builds their card in the pool. Without
                attendance (unlimited capacity), any volunteer still on the event. */}
            {r.role === "volunteer" && r.status === "approved" && started && (unlimited || r.attendance_status === "attended") && (
              <RateVolunteer
                registrationId={r.id}
                name={r.full_name}
                existing={volunteerRatings.get(r.id) ?? null}
                canRate={isCreator}
                onSaved={load}
              />
            )}
          </CardContent></Card>
        ))}

        {hasApproved && unlimited && (
          <p className="text-sm text-muted-foreground">
            U akce s neomezenou kapacitou se docházka nevyplňuje.
            {isCreator && !started && regs.some((r) => r.role === "volunteer" && r.status === "approved") &&
              " Dobrovolníky ohodnotíte, až akce začne."}
          </p>
        )}
        {hasApproved && !unlimited && !started && (
          <p className="text-sm text-muted-foreground">
            {isCreator ? "Docházku vyplníte, až akce začne." : "Docházku vyplní pořadatel, který akci založil, až akce začne."}
          </p>
        )}
        {isCreator && started && !unlimited && unmarked.length > 0 && (
          <div className="space-y-2 pt-2">
            <Button onClick={() => setConfirmOpen(true)} disabled={changeCount === 0} size="lg" className="h-12 w-full">
              <Check className="h-4 w-4" />
              {changeCount > 0 ? `Potvrdit docházku (${changeCount})` : "Potvrdit docházku"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Kdo je označený jako Přišel/a, dostane po potvrzení žádost o ohodnocení akce. Potvrzenou docházku už nejde
              změnit — chybu opraví jen admin obce.
            </p>
          </div>
        )}
      </div>

      <AlertDialog open={correction !== null} onOpenChange={(open) => !open && !correctBusy && setCorrection(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Opravit docházku {correction?.reg.full_name} na „
              {ATTENDANCE_OPTIONS.find((o) => o.value === correction?.status)?.label}“?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Docházka se počítá do spolehlivosti účastníka, kterou vidí pořadatelé. Opravte ji, jen když ji pořadatel
              zapsal chybně.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={correctBusy}>Zpět</AlertDialogCancel>
            <AlertDialogAction
              disabled={correctBusy}
              onClick={(e) => {
                e.preventDefault();
                correctAttendance();
              }}
            >
              {correctBusy ? "Ukládám…" : "Opravit"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && !removeBusy && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Odebrat {removing?.full_name} z akce?</AlertDialogTitle>
            <AlertDialogDescription>
              Uvolní se tím místo{removing?.role === "volunteer" ? " dobrovolníka" : ""} a dostane zprávu, že s ním na akci už
              nepočítáte. Sám se znovu přihlásit nepůjde — dokud mu to tady nepovolíte zpátky.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeBusy}>Zpět</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                removeFromEvent();
              }}
            >
              {removeBusy ? "Odebírám…" : "Odebrat z akce"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={rejecting !== null} onOpenChange={(open) => !open && !rejectBusy && setRejecting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Zamítnout přihlášku {rejecting?.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Dostane zprávu, že jste přihlášku zamítli, a sám se na akci znovu přihlásit nepůjde — dokud mu to tady
              nepovolíte zpátky.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rejectBusy}>Zpět</AlertDialogCancel>
            <AlertDialogAction
              disabled={rejectBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                reject();
              }}
            >
              {rejectBusy ? "Zamítám…" : "Zamítnout"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !confirming && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Potvrdit docházku?</AlertDialogTitle>
            <AlertDialogDescription>
              Docházku pak už nepůjde změnit — ani vámi, ani ostatními pořadateli; chybu opraví jen admin obce. Kdo
              přišel, dostane žádost o ohodnocení akce. Kdo nedorazil, dostane upozornění — po {NO_SHOW_LIMIT}{" "}
              neomluvených absencích za {RELIABILITY_WINDOW_MONTHS} měsíců mu přihlášky na čas potvrzuje pořadatel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="grid grid-cols-3 gap-2 text-center">
            {ATTENDANCE_OPTIONS.map(({ value, label, icon: Icon }) => (
              <li key={value} className="rounded-lg bg-muted px-2 py-2.5">
                <Icon className="mx-auto h-4 w-4 text-muted-foreground" aria-hidden />
                <p className="mt-1 text-2xl font-extrabold tabular-nums leading-none">{draftCount(value)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{label}</p>
              </li>
            ))}
          </ul>
          {unmarked.length > changeCount && (
            <p className="text-sm text-muted-foreground">
              U {unmarked.length - changeCount} {unmarked.length - changeCount === 1 ? "člověka" : "lidí"} zatím nic
              nevybíráte — docházku jim můžete doplnit později.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirming}>Zpět</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirming}
              onClick={(e) => {
                e.preventDefault();
                confirmAttendance();
              }}
            >
              {confirming ? "Ukládám…" : "Potvrdit natrvalo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** A confirmed attendance — shown, no longer chosen. */
function AttendanceResult({ status }: { status: AttendanceStatus }) {
  const option = ATTENDANCE_OPTIONS.find((o) => o.value === status);
  if (!option) return null;
  const Icon = option.icon;
  return (
    <p
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold",
        status === "attended" && "bg-success-soft text-success",
        status === "no_show" && "bg-destructive/10 text-destructive",
        status === "excused" && "bg-muted text-foreground",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden /> {option.label}
    </p>
  );
}

export default function ManageEventPage() {
  return (
    <RequireAuth>
      <RequireRole role="organizer">
        <ManageEventContent />
      </RequireRole>
    </RequireAuth>
  );
}
