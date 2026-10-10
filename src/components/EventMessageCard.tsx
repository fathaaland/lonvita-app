"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { PayloadApiError } from "@/integrations/payload/client";
import { sendEventMessage } from "@/integrations/payload/queries";
import { EVENT_MESSAGE_MAX_LENGTH } from "@/lib/eventMessage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** "Napsat přihlášeným" on Spravovat — a short message to everyone signed up (in the app and by
 * e-mail), until the event is over. The way to reach them once the list is frozen before the start. */
export function EventMessageCard({ eventId }: { eventId: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      const { recipients } = await sendEventMessage(eventId, message.trim());
      toast.success(recipients === 0 ? "Na akci zatím nikdo přihlášený není." : `Zpráva odeslána ${recipients} přihlášeným.`);
      setMessage("");
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Zprávu se nepodařilo odeslat.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <Label htmlFor="event-message" className="flex items-center gap-2 font-bold">
          <MessageSquare className="h-4 w-4 text-primary" aria-hidden /> Napsat přihlášeným
        </Label>
        <Textarea
          id="event-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={EVENT_MESSAGE_MAX_LENGTH}
          rows={3}
          placeholder="Např. sraz se přesouvá před hasičárnu, vezměte si pláštěnku…"
        />
        <p className="text-xs text-muted-foreground">
          Přijde všem přihlášeným (i čekajícím) v aplikaci a e-mailem. {message.length}/{EVENT_MESSAGE_MAX_LENGTH}
        </p>
        <Button onClick={send} disabled={busy || message.trim().length === 0} className="w-full h-11">
          {busy ? "Odesílám…" : "Odeslat zprávu"}
        </Button>
      </CardContent>
    </Card>
  );
}
