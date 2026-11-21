"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getOrganizersForAdmin,
  revokeOrganizerRole,
  setOrganizerVolunteerAccess,
  OrganizerRoleRow,
} from "@/integrations/payload/admin-queries";
import { RevokeOrganizerButton } from "@/components/admin/RequestsTable";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { HandHeart } from "lucide-react";
import { toast } from "sonner";
import { PayloadApiError } from "@/integrations/payload/client";

/** The obec's active organizers — who may run events, and who of them may use the volunteer pool. */
export function OrganizersTable({ municipalityId }: { municipalityId?: string }) {
  const { profile } = useAuth();
  const muniId = municipalityId || profile?.municipality_id;
  const [organizers, setOrganizers] = useState<OrganizerRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!muniId) return;
    setLoading(true);
    setOrganizers(await getOrganizersForAdmin(muniId));
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muniId]);

  const handleVolunteerAccess = async (userRoleId: string, volunteerAccess: boolean) => {
    setBusyId(userRoleId);
    try {
      await setOrganizerVolunteerAccess(userRoleId, volunteerAccess);
      toast.success(volunteerAccess ? "Přístup k dobrovolníkům povolen." : "Přístup k dobrovolníkům odebrán.");
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Nepodařilo se změnit přístup.");
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
    } catch (error) {
      // E.g. they've started running an event meanwhile — the server says so.
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Nepodařilo se odebrat roli.");
    } finally {
      setBusyId(null);
      await load();
    }
  };

  if (loading) return <p className="text-center text-muted-foreground py-8">Načítám…</p>;
  if (organizers.length === 0) return <p className="text-center text-muted-foreground py-8">Obec zatím nemá žádné organizátory.</p>;

  return (
    <div className="space-y-2">
      {organizers.map((o) => (
        <Card key={o.id}>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              {o.organization_id ? (
                <Link
                  href={`/organizace/organizatori?obec=${muniId}&organizace=${o.organization_id}`}
                  className="block font-semibold text-sm break-words hover:underline"
                >
                  {o.full_name}
                  {o.organization_name && o.organization_name !== o.full_name && (
                    <span className="font-normal text-muted-foreground"> ({o.organization_name})</span>
                  )}
                </Link>
              ) : (
                <p className="font-semibold text-sm break-words">{o.full_name}</p>
              )}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0" title="Přístup k poolu dobrovolníků">
              <HandHeart className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Dobrovolníci</span>
              <Switch
                aria-label={`Přístup k dobrovolníkům – ${o.full_name}`}
                checked={o.volunteer_access}
                disabled={busyId === o.id}
                onCheckedChange={(v) => handleVolunteerAccess(o.id, v)}
              />
            </label>
            <RevokeOrganizerButton organizer={o} busy={busyId === o.id} onConfirm={() => handleRevokeOrganizer(o.id)} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
