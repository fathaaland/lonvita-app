"use client";

import { useEffect, useState } from "react";
import {
  getOrganizerRequestsForAdmin,
  decideOrganizerRequest,
  getVolunteerFlagRequestsForAdmin,
  decideVolunteerFlagRequest,
  getCoOrganizingRequestsForAdmin,
  decideCoOrganizingRequest,
  getOrganizersForAdmin,
  revokeOrganizerRole,
  OrganizerRequestAdminRow,
  VolunteerFlagRequestAdminRow,
  CoOrganizingRequestAdminRow,
  OrganizerRoleRow,
} from "@/integrations/payload/admin-queries";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, X, UserPlus, HandHeart, Handshake, Users } from "lucide-react";
import { toast } from "sonner";
import { PayloadApiError } from "@/integrations/payload/client";
import { organizationTypeLabel } from "@/lib/organizations";

/** `municipalityId` = the obec this admin actually administers, which isn't necessarily their
 * home municipality (a superadmin can grant municipality_admin anywhere). */
export function RequestsTable({ municipalityId }: { municipalityId?: string }) {
  const { profile } = useAuth();
  const muniId = municipalityId || profile?.municipality_id;
  const [organizerRequests, setOrganizerRequests] = useState<OrganizerRequestAdminRow[]>([]);
  const [volunteerRequests, setVolunteerRequests] = useState<VolunteerFlagRequestAdminRow[]>([]);
  const [coOrganizingRequests, setCoOrganizingRequests] = useState<CoOrganizingRequestAdminRow[]>([]);
  const [organizers, setOrganizers] = useState<OrganizerRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!muniId) return;
    setLoading(true);
    const [org, vol, coOrg, activeOrganizers] = await Promise.all([
      getOrganizerRequestsForAdmin(muniId),
      getVolunteerFlagRequestsForAdmin(muniId),
      getCoOrganizingRequestsForAdmin(muniId),
      getOrganizersForAdmin(muniId),
    ]);
    setOrganizerRequests(org);
    setVolunteerRequests(vol);
    setCoOrganizingRequests(coOrg);
    setOrganizers(activeOrganizers);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muniId]);

  const handleOrganizerDecision = async (id: string, approve: boolean) => {
    setBusyId(id);
    try {
      await decideOrganizerRequest(id, approve);
      toast.success(approve ? "Role organizátora schválena." : "Žádost zamítnuta.");
      await load();
    } catch {
      toast.error("Nepodařilo se vyřídit žádost.");
    } finally {
      setBusyId(null);
    }
  };

  const handleVolunteerDecision = async (id: string, approve: boolean) => {
    setBusyId(id);
    try {
      await decideVolunteerFlagRequest(id, approve);
      toast.success(approve ? "Příznak Dobrovolnictví schválen." : "Žádost zamítnuta.");
      await load();
    } catch {
      toast.error("Nepodařilo se vyřídit žádost.");
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

  const handleRevokeOrganizer = async (userRoleId: string) => {
    setBusyId(userRoleId);
    try {
      await revokeOrganizerRole(userRoleId);
      toast.success("Role organizátora odebrána.");
      await load();
    } catch {
      toast.error("Nepodařilo se odebrat roli.");
    } finally {
      setBusyId(null);
    }
  };

  const totalCount =
    organizerRequests.length + volunteerRequests.length + coOrganizingRequests.length + organizers.length;

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
            <p className="font-bold text-sm">Žádosti o roli organizátora</p>
          </div>
          {organizerRequests.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{r.full_name}</p>
                    <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("cs-CZ")}</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-9 text-success border-success/40" disabled={busyId === r.id} onClick={() => handleOrganizerDecision(r.id, true)}>
                    <Check className="h-4 w-4" /> Schválit
                  </Button>
                  <Button size="sm" variant="outline" className="h-9 text-destructive border-destructive/40" disabled={busyId === r.id} onClick={() => handleOrganizerDecision(r.id, false)}>
                    <X className="h-4 w-4" /> Zamítnout
                  </Button>
                </div>
                <OrganizerRequestReason
                  reason={r.reason}
                  organizationName={r.organization_name}
                  organizationType={r.organization_type}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {volunteerRequests.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <HandHeart className="h-4 w-4 text-primary" />
            <p className="font-bold text-sm">Žádosti o příznak Dobrovolnictví</p>
          </div>
          {volunteerRequests.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{r.event_title}</p>
                  <p className="text-xs text-muted-foreground">{r.requested_by_name} · {new Date(r.created_at).toLocaleDateString("cs-CZ")}</p>
                </div>
                <Button size="sm" variant="outline" className="h-9 text-success border-success/40" disabled={busyId === r.id} onClick={() => handleVolunteerDecision(r.id, true)}>
                  <Check className="h-4 w-4" /> Schválit
                </Button>
                <Button size="sm" variant="outline" className="h-9 text-destructive border-destructive/40" disabled={busyId === r.id} onClick={() => handleVolunteerDecision(r.id, false)}>
                  <X className="h-4 w-4" /> Zamítnout
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {coOrganizingRequests.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Handshake className="h-4 w-4 text-primary" />
            <p className="font-bold text-sm">Žádosti o spolupořádání obcí</p>
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

      {organizers.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Users className="h-4 w-4 text-primary" />
            <p className="font-bold text-sm">Aktivní organizátoři</p>
          </div>
          {organizers.map((o) => (
            <Card key={o.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{o.full_name}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 text-destructive border-destructive/40"
                  disabled={busyId === o.id}
                  onClick={() => handleRevokeOrganizer(o.id)}
                >
                  <X className="h-4 w-4" /> Odebrat roli
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** A pořadatel asking the obec to co-organize their event — approving lists the obec among the
 * event's spolupořadatelé. */
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
            {request.requested_by_name} · {new Date(request.created_at).toLocaleDateString("cs-CZ")}
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-9 text-success border-success/40" disabled={busy} onClick={() => onDecide(true)}>
          <Check className="h-4 w-4" /> Schválit
        </Button>
        <Button size="sm" variant="outline" className="h-9 text-destructive border-destructive/40" disabled={busy} onClick={() => onDecide(false)}>
          <X className="h-4 w-4" /> Zamítnout
        </Button>
      </CardContent>
    </Card>
  );
}

/** The applicant's "why me" text — what the admin decides on. Requests filed before the reason
 * was asked for have none. */
export function OrganizerRequestReason({
  reason,
  organizationName,
  organizationType,
}: {
  reason: string | null;
  /** Who the applicant will organize as — approving creates this organization. */
  organizationName?: string | null;
  organizationType?: string | null;
}) {
  return (
    <>
      {organizationName && (
        <p className="text-sm">
          Za <span className="font-semibold">{organizationName}</span>
          <span className="text-muted-foreground"> · {organizationTypeLabel(organizationType)}</span>
        </p>
      )}
      {reason ? (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm whitespace-pre-line break-words">{reason}</p>
      ) : (
        <p className="text-xs italic text-muted-foreground">Žádost je bez zdůvodnění.</p>
      )}
    </>
  );
}
