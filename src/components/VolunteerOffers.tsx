"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, HandHeart, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import {
  decideVolunteerInvitation,
  getPendingVolunteerInvitationsForEvent,
  getVolunteerOffersForEvent,
  withdrawVolunteerInvitation,
  type PendingVolunteerInvitationRow,
  type VolunteerOfferRow,
} from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { focusLabel } from "@/components/VolunteerCard";
import { RatingStars } from "@/components/RatingStars";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Volunteers from the pool offering to help on the event — answered by its creator alone, who sees
 * each one's ratings from other organizers first (VolunteerInvitations, kind "application").
 * Renders nothing while there are none. */
export function VolunteerOffers({
  eventId,
  canDecide,
  onDecided,
}: {
  eventId: string;
  canDecide: boolean;
  /** An accepted offer puts the volunteer on the event — the attendee list reloads. */
  onDecided: () => void;
}) {
  const [offers, setOffers] = useState<VolunteerOfferRow[]>([]);
  // Invitations the creator sent, still unanswered — theirs to take back.
  const [invited, setInvited] = useState<PendingVolunteerInvitationRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () =>
    Promise.all([
      getVolunteerOffersForEvent(eventId)
        .then(setOffers)
        .catch(() => setOffers([])),
      canDecide
        ? getPendingVolunteerInvitationsForEvent(eventId)
            .then(setInvited)
            .catch(() => setInvited([]))
        : Promise.resolve(),
    ]);

  const withdraw = async (invitation: PendingVolunteerInvitationRow) => {
    setBusyId(invitation.id);
    try {
      await withdrawVolunteerInvitation(invitation.id);
      toast.success(`Pozvánka pro ${invitation.full_name} stažena.`);
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Pozvánku se nepodařilo stáhnout.");
    } finally {
      setBusyId(null);
      await load();
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const decide = async (offer: VolunteerOfferRow, accept: boolean) => {
    setBusyId(offer.id);
    try {
      await decideVolunteerInvitation(offer.id, accept);
      toast.success(accept ? `${offer.full_name} pomůže na akci.` : "Nabídka odmítnuta.");
      if (accept) onDecided();
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status < 500 ? error.message : "Rozhodnutí se nepodařilo uložit.",
      );
    } finally {
      setBusyId(null);
      await load();
    }
  };

  if (offers.length === 0 && invited.length === 0) return null;

  return (
    <>
      {invited.length > 0 && (
        <section className="space-y-2" aria-labelledby="volunteer-invited-heading">
          <h2 id="volunteer-invited-heading" className="flex items-center gap-2 px-1 font-bold">
            <HandHeart className="h-4 w-4 text-primary" aria-hidden />
            Pozvaní dobrovolníci — čekají na odpověď ({invited.length})
          </h2>
          {invited.map((invitation) => (
            <Card key={invitation.id}>
              <CardContent className="flex items-center gap-3 p-4">
                <Link href={`/dobrovolnik/${invitation.user_id}`} className="flex-1 min-w-0 truncate font-bold hover:underline">
                  {invitation.full_name}
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10"
                  disabled={busyId === invitation.id}
                  onClick={() => withdraw(invitation)}
                >
                  <Undo2 className="h-4 w-4" />Stáhnout pozvánku
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
      {offers.length > 0 && (
        <section className="space-y-2" aria-labelledby="volunteer-offers-heading">
          <h2 id="volunteer-offers-heading" className="flex items-center gap-2 px-1 font-bold">
            <HandHeart className="h-4 w-4 text-primary" aria-hidden />
            Nabídky pomoci od dobrovolníků ({offers.length})
          </h2>
          {offers.map((offer) => (
            <Card key={offer.id} className="border-primary/40">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <UserAvatar
                    name={offer.full_name}
                    src={offer.avatar_url}
                    className="h-10 w-10"
                    fallbackClassName="bg-primary text-primary-foreground"
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <Link href={`/dobrovolnik/${offer.user_id}`} className="font-bold hover:underline">
                      {offer.full_name}
                    </Link>
                    {offer.rating ? (
                      <div className="flex items-center gap-2 text-sm">
                        <RatingStars value={Math.round(offer.rating.average)} size="sm" label="Průměrné hodnocení" />
                        <span className="font-semibold tabular-nums">
                          {offer.rating.average.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })}
                        </span>
                        <span className="text-muted-foreground">({offer.rating.count}× hodnocen/a)</span>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Zatím bez hodnocení od pořadatelů</p>
                    )}
                    {offer.volunteer_focus && offer.volunteer_focus.length > 0 && (
                      <p className="text-xs text-muted-foreground">Pomáhá s: {offer.volunteer_focus.map(focusLabel).join(", ")}</p>
                    )}
                  </div>
                </div>
                {offer.message && <p className="rounded-lg bg-muted px-3 py-2 text-sm">„{offer.message}“</p>}
                {canDecide ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={() => decide(offer, true)} disabled={busyId === offer.id} className="h-11">
                      <Check className="h-4 w-4" />Přijmout
                    </Button>
                    <Button
                      onClick={() => decide(offer, false)}
                      disabled={busyId === offer.id}
                      variant="outline"
                      className="h-11"
                    >
                      <X className="h-4 w-4" />Odmítnout
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">O nabídce rozhodne pořadatel, který akci založil.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </>
  );
}
