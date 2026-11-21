"use client";

import { useEffect, useState } from "react";
import {
  getOrganizerRequestsForAdmin,
  decideOrganizerRequest,
  getCoOrganizingRequestsForAdmin,
  decideCoOrganizingRequest,
  getEscalatedDeletionRequestsForAdmin,
  decideEscalatedDeletionRequest,
  EscalatedDeletionRequestRow,
  getReviewComplaintsForAdmin,
  getRunningEventsOfOrganizer,
  OrganizerRequestAdminRow,
  CoOrganizingRequestAdminRow,
  ReviewComplaintAdminRow,
  RunningOrganizerEvent,
  OrganizerRoleRow,
} from "@/integrations/payload/admin-queries";
import { ReviewComplaintCard } from "@/components/admin/ReviewComplaintCard";
import { ConfirmActionButton } from "@/components/ConfirmActionButton";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Check, X, UserPlus, Handshake, Flag, UserMinus, HandHeart } from "lucide-react";
import { VOLUNTEER_ACCESS_KIND } from "@/lib/organizer-request-kinds";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatEventDateTime, APP_TIME_ZONE } from "@/lib/date";
import { toast } from "sonner";
import { PayloadApiError } from "@/integrations/payload/client";
import { organizationTypeLabel } from "@/lib/organizations";

/** `municipalityId` = the obec this admin actually administers, which isn't necessarily their
 * home municipality (a superadmin can grant municipality_admin anywhere). */
export function RequestsTable({
  municipalityId,
  onPendingCountChange,
}: {
  municipalityId?: string;
  /** What still waits on a decision — keeps the tab's badge current. */
  onPendingCountChange?: (count: number) => void;
}) {
  const { profile } = useAuth();
  const muniId = municipalityId || profile?.municipality_id;
  const [organizerRequests, setOrganizerRequests] = useState<OrganizerRequestAdminRow[]>([]);
  const [coOrganizingRequests, setCoOrganizingRequests] = useState<CoOrganizingRequestAdminRow[]>([]);
  const [reviewComplaints, setReviewComplaints] = useState<ReviewComplaintAdminRow[]>([]);
  const [escalated, setEscalated] = useState<EscalatedDeletionRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!muniId) return;
    setLoading(true);
    const [org, coOrg, leaving, complaints] = await Promise.all([
      getOrganizerRequestsForAdmin(muniId),
      getCoOrganizingRequestsForAdmin(muniId),
      getEscalatedDeletionRequestsForAdmin(muniId).catch(() => [] as EscalatedDeletionRequestRow[]),
      getReviewComplaintsForAdmin(muniId).catch(() => [] as ReviewComplaintAdminRow[]),
    ]);
    setOrganizerRequests(org);
    setCoOrganizingRequests(coOrg);
    setEscalated(leaving);
    setReviewComplaints(complaints);
    setLoading(false);
    onPendingCountChange?.(org.length + coOrg.length + leaving.length + complaints.length);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muniId]);

  const handleOrganizerDecision = async (request: OrganizerRequestAdminRow, decision: OrganizerDecision) => {
    setBusyId(request.id);
    try {
      await decideOrganizerRequest(request.id, decision !== "reject", decision === "approve-all");
      toast.success(organizerDecisionToast(request, decision));
      await load();
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Nepodařilo se vyřídit žádost.");
    } finally {
      setBusyId(null);
    }
  };

  const handleCoOrganizingDecision = async (id: string, approve: boolean) => {
    setBusyId(id);
    try {
      await decideCoOrganizingRequest(id, approve);
      toast.success(approve ? "Obec teď akci spolupořádá." : "Žádost zamítnuta.");
    } catch (error) {
      // E.g. the event was cancelled meanwhile — the server says so.
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Nepodařilo se vyřídit žádost.");
    } finally {
      setBusyId(null);
      await load();
    }
  };

  const handleEscalatedDecision = async (id: string, remove: boolean) => {
    setBusyId(id);
    try {
      await decideEscalatedDeletionRequest(id, remove);
      toast.success(remove ? "Žadatel z akce odebrán." : "Žádost zamítnuta, pořadatelé zůstávají.");
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Nepodařilo se vyřídit žádost.");
    } finally {
      setBusyId(null);
      await load();
    }
  };

  const totalCount =
    organizerRequests.length +
    coOrganizingRequests.length +
    escalated.length +
    reviewComplaints.length;

  if (loading) return <p className="text-center text-muted-foreground py-8">Načítám…</p>;

  if (totalCount === 0) {
    return <p className="text-center text-muted-foreground py-8">Žádné čekající žádosti.</p>;
  }

  return (
    <div className="space-y-5">
      {organizerRequests.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <UserPlus className="h-4 w-4 text-primary" />
            <p className="font-bold text-sm">Žádosti organizátorů</p>
          </div>
          {organizerRequests.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{r.full_name}</p>
                    <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("cs-CZ", { timeZone: APP_TIME_ZONE })}</p>
                  </div>
                </div>
                <OrganizerRequestReason
                  reason={r.reason}
                  organizationName={r.organization_name}
                  organizationType={r.organization_type}
                  kind={r.kind}
                  volunteerAccessRequested={r.volunteer_access_requested}
                />
                <OrganizerRequestDecisionButtons
                  request={r}
                  busy={busyId === r.id}
                  onDecide={(decision) => handleOrganizerDecision(r, decision)}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {coOrganizingRequests.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Handshake className="h-4 w-4 text-primary" />
            <p className="font-bold text-sm">Pozvánky obci ke spolupořádání</p>
          </div>
          {coOrganizingRequests.map((r) => (
            <CoOrganizingRequestCard
              key={r.id}
              request={r}
              busy={busyId === r.id}
              onDecide={(approve) => handleCoOrganizingDecision(r.id, approve)}
            />
          ))}
        </div>
      )}

      {escalated.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <UserMinus className="h-4 w-4 text-primary" />
            <p className="font-bold text-sm">Žádosti o zrušení spolupořadatelství</p>
          </div>
          {escalated.map((r) => (
            <EscalatedDeletionRequestCard
              key={r.id}
              request={r}
              busy={busyId === r.id}
              onDecide={(remove) => handleEscalatedDecision(r.id, remove)}
            />
          ))}
        </div>
      )}

      {reviewComplaints.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Flag className="h-4 w-4 text-primary" />
            <p className="font-bold text-sm">Stížnosti na recenze</p>
          </div>
          {reviewComplaints.map((c) => (
            <ReviewComplaintCard key={c.id} complaint={c} onDecided={load} />
          ))}
        </div>
      )}
    </div>
  );
}

/** An invitation to co-organize an event — for the obec (its admins answer) or for one of the
 * viewer's organizations. Accepting lists the organization among the event's spolupořadatelé. */
export function CoOrganizingRequestCard({
  request,
  busy,
  onDecide,
  subtitle,
}: {
  request: CoOrganizingRequestAdminRow;
  busy: boolean;
  onDecide: (approve: boolean) => void;
  /** Extra context in front of the requester, e.g. the obec in the superadmin hub. */
  subtitle?: string;
}) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {request.event_id ? (
            <a href={`/akce/${request.event_id}`} className="font-semibold text-sm truncate block hover:underline">
              {request.event_title}
            </a>
          ) : (
            <p className="font-semibold text-sm truncate">{request.event_title}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {subtitle ? `${subtitle} · ` : ""}
            zve {request.requested_by_name} · platí do {formatEventDateTime(request.expires_at)}
          </p>
        </div>
        <ConfirmActionButton
          size="sm"
          variant="outline"
          className="h-9 text-success border-success/40"
          disabled={busy}
          title={`Přijmout spolupořádání akce „${request.event_title}“?`}
          description={`${request.organization_name} se stane spolupořadatelem akce a bude ji moct upravovat. Rozhodnutí nejde vrátit.`}
          confirmLabel="Přijmout"
          onConfirm={() => onDecide(true)}
        >
          <Check className="h-4 w-4" /> Přijmout
        </ConfirmActionButton>
        <ConfirmActionButton
          size="sm"
          variant="outline"
          className="h-9 text-destructive border-destructive/40"
          disabled={busy}
          title={`Odmítnout pozvánku na akci „${request.event_title}“?`}
          description={`${request.requested_by_name} se dozví, že pozvánku ke spolupořádání odmítáte. Rozhodnutí nejde vrátit.`}
          confirmLabel="Odmítnout"
          destructive
          onConfirm={() => onDecide(false)}
        >
          <X className="h-4 w-4" /> Odmítnout
        </ConfirmActionButton>
      </CardContent>
    </Card>
  );
}

/** An organizer wants to stop running an event, a spolupořadatel refused to let them go — the obec
 * may take them off it without that consent (EventDeletionRequests, …/municipality-decide). */
function EscalatedDeletionRequestCard({
  request,
  busy,
  onDecide,
}: {
  request: EscalatedDeletionRequestRow;
  busy: boolean;
  onDecide: (remove: boolean) => void;
}) {
  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="min-w-0">
          {request.event_id ? (
            <a href={`/akce/${request.event_id}`} className="font-semibold text-sm truncate block hover:underline">
              {request.event_title}
            </a>
          ) : (
            <p className="font-semibold text-sm truncate">{request.event_title}</p>
          )}
          <p className="text-xs text-muted-foreground">rozhodněte do {formatEventDateTime(request.expires_at)}</p>
        </div>
        <p className="text-sm">
          <span className="font-semibold">{request.requested_by_name}</span> chce přestat akci pořádat,{" "}
          <span className="font-semibold">{request.rejected_by_name}</span> nesouhlasí se smazáním akce ani s jeho
          odchodem.
          {request.requester_is_organizer && " Je hlavním pořadatelem — když ho odeberete, akce přejde na spolupořadatele."}
        </p>
        <div className="flex gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" className="flex-1 h-9 text-destructive border-destructive/40" disabled={busy}>
                <UserMinus className="h-4 w-4" /> Odebrat žadatele
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Odebrat {request.requested_by_name} z akce?</AlertDialogTitle>
                <AlertDialogDescription>
                  Akci přestane pořádat i bez souhlasu spolupořadatele
                  {request.requester_is_organizer ? " a akce přejde na spolupořadatele" : ""}. Akce sama zůstane, jak je.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Zpět</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDecide(true)}>Odebrat žadatele</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <ConfirmActionButton
            size="sm"
            variant="outline"
            className="flex-1 h-9"
            disabled={busy}
            title="Zamítnout žádost o odchod z akce?"
            description={`${request.requested_by_name} zůstane pořadatelem akce „${request.event_title}“. Rozhodnutí nejde vrátit.`}
            confirmLabel="Zamítnout"
            onConfirm={() => onDecide(false)}
          >
            <X className="h-4 w-4" /> Zamítnout
          </ConfirmActionButton>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Revoking the organizer role asks first — and looks up what they still run in the obec. While
 * there's any, the role can't go (the server refuses it too, UserRoles keepRunningEventsOrganized):
 * the dialog lists the events and offers no revoke.
 */
export function RevokeOrganizerButton({
  organizer,
  busy,
  onConfirm,
}: {
  organizer: OrganizerRoleRow;
  busy: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<RunningOrganizerEvent[] | null>(null);

  const openDialog = () => {
    setRunning(null);
    setOpen(true);
    getRunningEventsOfOrganizer(organizer.id)
      .then(setRunning)
      .catch(() => {
        setOpen(false);
        toast.error("Nepodařilo se zjistit akce organizátora.");
      });
  };
  const blocked = running !== null && running.length > 0;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant="outline"
        className="h-9 text-destructive border-destructive/40"
        disabled={busy}
        onClick={openDialog}
      >
        <X className="h-4 w-4" /> Odebrat roli
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {blocked ? "Roli teď odebrat nejde" : `Odebrat roli organizátora – ${organizer.full_name}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {running === null
              ? "Zjišťuji, jestli v obci pořádá nějaké akce…"
              : blocked
                ? `${organizer.full_name} má v obci rozjeté akce. Roli mu půjde odebrat, až proběhnou, nebo když se zruší.`
                : "Nové akce v obci už zakládat nebude a zmizí z přehledu organizátorů. Dozví se to oznámením."}
          </AlertDialogDescription>
          {blocked && (
            <ul className="mt-2 space-y-1.5 text-sm text-left">
              {running.map((e) => (
                <li key={e.id} className="rounded-md border p-2">
                  <a href={`/akce/${e.id}`} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                    {e.title}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    {formatEventDateTime(e.date_time)} · {e.organizes === "runs" ? "pořádá" : "spolupořádá"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{blocked ? "Rozumím" : "Zpět"}</AlertDialogCancel>
          {!blocked && (
            <AlertDialogAction
              disabled={running === null}
              onClick={onConfirm}
              className={buttonVariants({ variant: "destructive" })}
            >
              Odebrat roli
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export type OrganizerDecision = "approve-all" | "approve-role" | "reject";

export function organizerDecisionToast(request: OrganizerRequestAdminRow, decision: OrganizerDecision): string {
  if (decision === "reject") return "Žádost zamítnuta.";
  if (request.kind === VOLUNTEER_ACCESS_KIND) return "Přístup k dobrovolníkům schválen.";
  return decision === "approve-all" ? "Role organizátora i přístup k dobrovolníkům schváleny." : "Role organizátora schválena.";
}

/**
 * The obec's answer to a request. A role request that asks for the volunteer pool too may be approved
 * whole, as the role alone, or turned down; one for the pool alone is approved or turned down.
 * `place` — e.g. " v obci X" in the superadmin hub.
 */
export function OrganizerRequestDecisionButtons({
  request: r,
  busy,
  onDecide,
  place = "",
}: {
  request: OrganizerRequestAdminRow;
  busy: boolean;
  onDecide: (decision: OrganizerDecision) => void;
  place?: string;
}) {
  const accessOnly = r.kind === VOLUNTEER_ACCESS_KIND;
  const as = r.organization_name ? ` za „${r.organization_name}“` : "";
  return (
    <div className="flex flex-wrap gap-2">
      {accessOnly ? (
        <ConfirmActionButton
          size="sm"
          variant="outline"
          className="h-9 text-success border-success/40"
          disabled={busy}
          title={`Povolit přístup k dobrovolníkům – ${r.full_name}?`}
          description={`${r.full_name} uvidí pool dobrovolníků${place || " obce"} a jejího mikroregionu, bude je moct zvát a hledat je na svých akcích. Přístup můžete později odebrat v seznamu organizátorů.`}
          confirmLabel="Povolit"
          onConfirm={() => onDecide("approve-all")}
        >
          <Check className="h-4 w-4" /> Povolit přístup
        </ConfirmActionButton>
      ) : (
        <>
          {r.volunteer_access_requested && (
            <ConfirmActionButton
              size="sm"
              variant="outline"
              className="h-9 text-success border-success/40"
              disabled={busy}
              title={`Schválit vše – ${r.full_name}?`}
              description={`${r.full_name} dostane${place || " v obci"} roli organizátora${as} a přístup k poolu dobrovolníků obce a jejího mikroregionu. Přístup můžete později odebrat v seznamu organizátorů.`}
              confirmLabel="Schválit vše"
              onConfirm={() => onDecide("approve-all")}
            >
              <Check className="h-4 w-4" /> Schválit vše
            </ConfirmActionButton>
          )}
          <ConfirmActionButton
            size="sm"
            variant="outline"
            className="h-9 text-success border-success/40"
            disabled={busy}
            title={`${r.volunteer_access_requested ? "Schválit jen roli organizátora" : "Schválit žádost"} – ${r.full_name}?`}
            description={`${r.full_name} dostane${place || " v obci"} roli organizátora${as} a bude moct zakládat akce${r.volunteer_access_requested ? " — bez přístupu k dobrovolníkům; ten mu můžete povolit později" : ""}.`}
            confirmLabel="Schválit"
            onConfirm={() => onDecide("approve-role")}
          >
            <Check className="h-4 w-4" /> {r.volunteer_access_requested ? "Jen pořádání akcí" : "Schválit"}
          </ConfirmActionButton>
        </>
      )}
      <ConfirmActionButton
        size="sm"
        variant="outline"
        className="h-9 text-destructive border-destructive/40"
        disabled={busy}
        title={`Zamítnout žádost – ${r.full_name}?`}
        description={
          accessOnly
            ? "Organizátor se dozví, že jeho žádost o přístup k dobrovolníkům byla zamítnuta. Roli organizátora si ponechá."
            : "Žadatel se dozví, že jeho žádost o roli organizátora byla zamítnuta. Rozhodnutí nejde vrátit."
        }
        confirmLabel="Zamítnout"
        destructive
        onConfirm={() => onDecide("reject")}
      >
        <X className="h-4 w-4" /> Zamítnout
      </ConfirmActionButton>
    </div>
  );
}

/** The applicant's "why me" text — what the admin decides on. Requests filed before the reason
 * was asked for have none. */
export function OrganizerRequestReason({
  reason,
  organizationName,
  organizationType,
  kind,
  volunteerAccessRequested,
}: {
  reason: string | null;
  /** Who the applicant will organize as — approving creates this organization. */
  organizationName?: string | null;
  organizationType?: string | null;
  kind?: string;
  volunteerAccessRequested?: boolean;
}) {
  return (
    <>
      {kind === VOLUNTEER_ACCESS_KIND ? (
        <p className="text-sm flex items-center gap-1.5">
          <HandHeart className="h-4 w-4 text-primary" aria-hidden />
          Organizátor žádá o přístup k poolu dobrovolníků.
        </p>
      ) : (
        volunteerAccessRequested && (
          <p className="text-sm flex items-center gap-1.5">
            <HandHeart className="h-4 w-4 text-primary" aria-hidden />
            Žádá i o přístup k poolu dobrovolníků.
          </p>
        )
      )}
      {organizationName && (
        <p className="text-sm">
          Za <span className="font-semibold">{organizationName}</span>
          <span className="text-muted-foreground"> · {organizationTypeLabel(organizationType)}</span>
        </p>
      )}
      {reason ? (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm whitespace-pre-line break-words">{reason}</p>
      ) : (
        kind !== VOLUNTEER_ACCESS_KIND && <p className="text-xs italic text-muted-foreground">Žádost je bez zdůvodnění.</p>
      )}
    </>
  );
}
