"use client";

import { useEffect, useState } from "react";
import { HandHeart } from "lucide-react";
import { toast } from "sonner";
import { hasPendingVolunteerFlagRequest, requestVolunteerFlag } from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** The volunteering flag for the event's creator when the obec has locked them out of editing it
 * (it co-organizes the event) — the flag stays theirs to ask for (Events guardIsVolunteering). */
export function VolunteeringRequestCard({ eventId, isVolunteering }: { eventId: string; isVolunteering: boolean }) {
  const { user } = useAuth();
  const [pending, setPending] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (isVolunteering) return;
    hasPendingVolunteerFlagRequest(eventId)
      .then(setPending)
      .catch(() => setPending(false));
  }, [eventId, isVolunteering]);

  const request = async () => {
    if (!user) return;
    setSending(true);
    try {
      await requestVolunteerFlag(eventId, String(user.id));
      setPending(true);
      toast.success("Žádost o příznak Dobrovolnictví odeslána obci.");
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status < 500 ? error.message : "Žádost se nepodařilo odeslat.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-3">
        <HandHeart className="h-5 w-5 mt-0.5 shrink-0 text-primary" aria-hidden />
        <div className="flex-1 space-y-3">
          <div>
            <p className="font-bold">Dobrovolnictví</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isVolunteering
                ? "Akce je označená jako dobrovolnická. Dobrovolníky na ni zvete z poolu dobrovolníků."
                : pending
                  ? "Žádost o příznak Dobrovolnictví čeká na schválení obcí."
                  : "Akci jste založili vy, takže o příznak Dobrovolnictví žádáte vy — schvaluje ho obec."}
            </p>
          </div>
          {!isVolunteering && pending === false && (
            <Button onClick={request} disabled={sending} className="h-11">
              {sending ? "Odesílám…" : "Požádat o příznak Dobrovolnictví"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
