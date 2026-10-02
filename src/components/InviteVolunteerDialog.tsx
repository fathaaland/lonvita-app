"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getMyOrganizedEvents,
  getPendingVolunteerInvitationEventIds,
  inviteVolunteer,
  EventRow,
} from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

/** Asks one volunteer from the pool to help on one of the viewer's upcoming events — the ones they
 * may edit (with the obec on an event, only its admins). The volunteer accepts or declines in their
 * profile. */
export function InviteVolunteerDialog({
  volunteer,
  onOpenChange,
}: {
  /** Who's being invited; null keeps the dialog closed. */
  volunteer: { user_id: string; full_name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, administeredMunicipalityIds } = useAuth();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [alreadyInvited, setAlreadyInvited] = useState<Set<string>>(new Set());
  const [eventId, setEventId] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!volunteer || !user) return;
    let active = true;
    setEvents(null);
    setEventId("");
    setMessage("");
    (async () => {
      const all = await getMyOrganizedEvents(String(user.id), administeredMunicipalityIds).catch(() => [] as EventRow[]);
      const upcoming = all
        .filter((e) => e.status !== "cancelled" && !e.locked_for_viewer && new Date(e.date_time).getTime() > Date.now())
        .sort((a, b) => a.date_time.localeCompare(b.date_time));
      const invited = await getPendingVolunteerInvitationEventIds(volunteer.user_id, upcoming.map((e) => e.id)).catch(
        () => new Set<string>(),
      );
      if (!active) return;
      setAlreadyInvited(invited);
      setEvents(upcoming);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volunteer?.user_id, user?.id]);

  const send = async () => {
    if (!volunteer || !eventId) return;
    setSending(true);
    try {
      await inviteVolunteer(eventId, volunteer.user_id, message);
      toast.success(`Pozvánka odeslána. ${volunteer.full_name} ji uvidí v profilu.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status < 500 ? error.message : "Pozvánku se nepodařilo odeslat.",
      );
    } finally {
      setSending(false);
    }
  };

  const available = (events ?? []).filter((e) => !alreadyInvited.has(e.id));

  return (
    <Dialog open={volunteer !== null} onOpenChange={(open) => !sending && onOpenChange(open)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pozvat na akci</DialogTitle>
          <DialogDescription>
            {volunteer?.full_name} dostane pozvánku a rozhodne se sám. Když ji přijme, bude na akci zapsaný jako
            dobrovolník a nezabere místo účastníkům.
          </DialogDescription>
        </DialogHeader>

        {events === null ? (
          <p className="text-sm text-muted-foreground py-2">Načítám vaše akce…</p>
        ) : available.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            {events.length === 0
              ? "Nemáte žádnou nadcházející akci, kterou byste mohli upravovat."
              : "Na všechny vaše nadcházející akce už pozvánku má."}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-event">Akce</Label>
              <Select value={eventId} onValueChange={setEventId}>
                <SelectTrigger id="invite-event" className="h-11">
                  <SelectValue placeholder="Vyberte akci" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.title} · {formatWhen(e.date_time)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-message">S čím potřebujete pomoct (nepovinné)</Label>
              <Textarea
                id="invite-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Např. potřebujeme odvézt dva seniory z Lhoty a zpět."
                maxLength={500}
                rows={3}
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Zrušit
          </Button>
          <Button onClick={send} disabled={!eventId || sending}>
            {sending ? "Odesílám…" : "Poslat pozvánku"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
