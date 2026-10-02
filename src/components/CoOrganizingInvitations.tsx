"use client";

import { useEffect, useState } from "react";
import { Handshake } from "lucide-react";
import { toast } from "sonner";
import {
  decideCoOrganizingRequest,
  getMyCoOrganizingInvitations,
  type CoOrganizingRequestAdminRow,
} from "@/integrations/payload/admin-queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { CoOrganizingRequestCard } from "@/components/admin/RequestsTable";

/** Invitations for the user's own organizations to co-organize someone else's event — they join
 * only once accepted here (CoOrganizingRequests). Renders nothing while there are none. */
export function CoOrganizingInvitations({ userId, onAccepted }: { userId: string; onAccepted: () => void }) {
  const [invitations, setInvitations] = useState<CoOrganizingRequestAdminRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () =>
    getMyCoOrganizingInvitations(userId)
      .then(setInvitations)
      .catch(() => setInvitations([]));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleDecide = async (id: string, approve: boolean) => {
    setBusyId(id);
    try {
      await decideCoOrganizingRequest(id, approve);
      toast.success(approve ? "Pozvánka přijata — akci teď spolupořádáte." : "Pozvánka odmítnuta.");
      if (approve) onAccepted();
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status < 500 ? error.message : "Rozhodnutí se nepodařilo uložit.",
      );
    } finally {
      setBusyId(null);
      await load();
    }
  };

  if (invitations.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <Handshake className="h-4 w-4 text-primary" />
        <p className="font-bold text-sm">Pozvánky ke spolupořádání</p>
      </div>
      {invitations.map((r) => (
        <CoOrganizingRequestCard
          key={r.id}
          request={r}
          busy={busyId === r.id}
          subtitle={r.organization_name}
          onDecide={(approve) => handleDecide(r.id, approve)}
        />
      ))}
    </section>
  );
}
