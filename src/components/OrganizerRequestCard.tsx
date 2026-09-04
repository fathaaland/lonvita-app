"use client";

import { useEffect, useState } from "react";
import { getMyOrganizerRequests, requestOrganizerRole, RequestStatus } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Megaphone, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";

export function OrganizerRequestCard() {
  const { user, profile, isOrganizer, isSuperAdmin } = useAuth();
  const [status, setStatus] = useState<RequestStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user || !profile?.municipality_id) return;
    getMyOrganizerRequests(String(user.id)).then((reqs) => {
      const forHome = reqs.find((r) => r.municipality_id === profile.municipality_id);
      setStatus(forHome?.status ?? null);
      setLoading(false);
    });
  }, [user, profile?.municipality_id]);

  // Already an organizer/admin, or platform superadmin — nothing to request.
  if (isOrganizer || isSuperAdmin || loading || !profile?.municipality_id) return null;

  const handleRequest = async () => {
    if (!user || !profile?.municipality_id) return;
    setSubmitting(true);
    try {
      await requestOrganizerRole(String(user.id), profile.municipality_id);
      setStatus("pending");
      toast.success("Žádost odeslána, obec ji vyřídí.");
    } catch {
      toast.error("Žádost se nepodařilo odeslat.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-primary" />
          <p className="font-bold">Role organizátora</p>
        </div>
        {status === "pending" ? (
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-4 w-4" /> Žádost čeká na vyřízení obcí.
          </p>
        ) : (
          <>
            {status === "rejected" && (
              <p className="text-sm text-destructive flex items-center gap-1.5">
                <XCircle className="h-4 w-4" /> Předchozí žádost byla zamítnuta.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Chcete v obci pořádat vlastní akce? Požádejte o roli organizátora.
            </p>
            <Button onClick={handleRequest} disabled={submitting} variant="outline" className="w-full h-11">
              Požádat o roli organizátora
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
