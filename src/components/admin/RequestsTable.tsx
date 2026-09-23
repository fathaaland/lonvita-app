"use client";

import { useEffect, useState } from "react";
import {
  getOrganizerRequestsForAdmin,
  decideOrganizerRequest,
  getVolunteerFlagRequestsForAdmin,
  decideVolunteerFlagRequest,
  getOrganizersForAdmin,
  revokeOrganizerRole,
  OrganizerRequestAdminRow,
  VolunteerFlagRequestAdminRow,
  OrganizerRoleRow,
} from "@/integrations/payload/admin-queries";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, X, UserPlus, HandHeart, Users } from "lucide-react";
import { toast } from "sonner";
import { organizationTypeLabel } from "@/lib/organizations";

/** `municipalityId` = the obec this admin actually administers, which isn't necessarily their
 * home municipality (a superadmin can grant municipality_admin anywhere). */
export function RequestsTable({ municipalityId }: { municipalityId?: string }) {
  const { profile } = useAuth();
  const muniId = municipalityId || profile?.municipality_id;
  const [organizerRequests, setOrganizerRequests] = useState<OrganizerRequestAdminRow[]>([]);
  const [volunteerRequests, setVolunteerRequests] = useState<VolunteerFlagRequestAdminRow[]>([]);
  const [organizers, setOrganizers] = useState<OrganizerRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!muniId) return;
    setLoading(true);
    const [org, vol, activeOrganizers] = await Promise.all([
      getOrganizerRequestsForAdmin(muniId),
      getVolunteerFlagRequestsForAdmin(muniId),
      getOrganizersForAdmin(muniId),
    ]);
    setOrganizerRequests(org);
    setVolunteerRequests(vol);
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

  const totalCount = organizerRequests.length + volunteerRequests.length + organizers.length;

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
