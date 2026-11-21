"use client";

import { useEffect, useState } from "react";
import { HandHeart, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";

import {
  getMyOrganizerRequests,
  requestVolunteerAccess,
  RequestStatus,
  withdrawOrganizerRequest,
} from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { VOLUNTEER_ACCESS_KIND } from "@/lib/organizer-request-kinds";
import { ORGANIZER_REASON_MAX_LENGTH } from "@/lib/validation";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/ConfirmActionButton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * In place of the volunteer pool, for an organizer the obec hasn't let in yet: they ask the obec for
 * it (OrganizerRequests kind "volunteer_access"), see the request wait, or take it back. The obec's
 * admins decide — the organizer never grants it to themselves.
 */
export function VolunteerAccessRequestCard({
  municipalityId,
  municipalityName,
  region,
}: {
  municipalityId: string;
  municipalityName: string;
  /** The obec's mikroregion, when it has one — its pool is shared. */
  region?: { name: string } | null;
}) {
  const { user } = useAuth();
  const [status, setStatus] = useState<RequestStatus | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    getMyOrganizerRequests(String(user.id))
      .then((reqs) => {
        const latest = reqs.find((r) => r.municipality_id === municipalityId && r.kind === VOLUNTEER_ACCESS_KIND);
        setStatus(latest?.status ?? null);
        setPendingId(latest?.status === "pending" ? latest.id : null);
      })
      .finally(() => setLoading(false));
  }, [user, municipalityId]);

  if (loading || !user) return null;

  const where = region ? `obce ${municipalityName} a mikroregionu ${region.name}` : `obce ${municipalityName}`;

  const handleRequest = async () => {
    setSubmitting(true);
    try {
      const id = await requestVolunteerAccess(String(user.id), municipalityId, reason.trim());
      setStatus("pending");
      setPendingId(id);
      setFormOpen(false);
      setReason("");
      toast.success("Žádost odeslána, obec ji vyřídí.");
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Žádost se nepodařilo odeslat.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    if (!pendingId) return;
    setSubmitting(true);
    try {
      await withdrawOrganizerRequest(pendingId);
      setStatus(null);
      setPendingId(null);
      toast.success("Žádost stažena.");
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Žádost se nepodařilo stáhnout.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <HandHeart className="h-5 w-5 text-primary" />
          <p className="font-bold">Pool dobrovolníků</p>
        </div>
        {status === "pending" ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-4 w-4" /> Žádost o přístup k dobrovolníkům čeká na vyřízení obcí.
            </p>
            <ConfirmActionButton
              disabled={submitting}
              variant="ghost"
              className="w-full h-11 text-muted-foreground"
              title="Stáhnout žádost o přístup k dobrovolníkům?"
              description="Obec ji už neuvidí. Požádat můžete později znovu."
              confirmLabel="Stáhnout žádost"
              destructive
              onConfirm={handleWithdraw}
            >
              Stáhnout žádost
            </ConfirmActionButton>
          </div>
        ) : (
          <>
            {status === "rejected" && (
              <p className="text-sm text-destructive flex items-center gap-1.5">
                <XCircle className="h-4 w-4" /> Předchozí žádost byla zamítnuta.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              K dobrovolníkům {where} zatím přístup nemáte — nevidíte je, nemůžete je zvát ani u svých akcí hledat
              dobrovolníky. Přístup vám povolí obec.
            </p>
            {formOpen ? (
              <div className="space-y-2">
                <Label htmlFor="volunteer-access-reason">Proč dobrovolníky potřebujete? (nepovinné)</Label>
                <Textarea
                  id="volunteer-access-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={ORGANIZER_REASON_MAX_LENGTH}
                  rows={3}
                  placeholder="Např. pořádáme úklid obce a potřebujeme pomocníky…"
                />
                <div className="flex flex-col gap-2 pt-1">
                  <Button onClick={handleRequest} disabled={submitting} className="w-full h-11">
                    Odeslat žádost
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full h-11 text-muted-foreground"
                    onClick={() => setFormOpen(false)}
                    disabled={submitting}
                  >
                    Zpět
                  </Button>
                </div>
              </div>
            ) : (
              <Button onClick={() => setFormOpen(true)} variant="outline" className="w-full h-11">
                Požádat o přístup k dobrovolníkům
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
