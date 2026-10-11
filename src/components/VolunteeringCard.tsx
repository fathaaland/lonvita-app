"use client";

import { useState } from "react";
import { HandHeart } from "lucide-react";
import { toast } from "sonner";
import { setEventVolunteering } from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** The volunteering flag for the event's creator when the obec has locked them out of editing it
 * (it co-organizes the event) — the flag stays theirs to set, no approval needed. Once a volunteer
 * has signed up it can't come off (Events guardIsVolunteering) — the button goes. */
export function VolunteeringCard({
  eventId,
  isVolunteering: initial,
  locked = false,
  onChanged,
}: {
  eventId: string;
  isVolunteering: boolean;
  /** A volunteer has signed up (EventRow.volunteering_locked). */
  locked?: boolean;
  /** E.g. for the event detail to show the volunteering parts that come with the flag. */
  onChanged?: (isVolunteering: boolean) => void;
}) {
  const [isVolunteering, setIsVolunteering] = useState(initial);
  const [saving, setSaving] = useState(false);

  const toggle = async () => {
    setSaving(true);
    try {
      const next = await setEventVolunteering(eventId, !isVolunteering);
      setIsVolunteering(next);
      onChanged?.(next);
      toast.success(next ? "Akce je označená jako dobrovolnická." : "Označení dobrovolnické akce odebráno.");
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status < 500 ? error.message : "Změnu se nepodařilo uložit.",
      );
    } finally {
      setSaving(false);
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
              {isVolunteering && locked
                ? "Akce je označená jako dobrovolnická. Přihlásil se už dobrovolník, takže označení zůstává."
                : isVolunteering
                  ? "Akce je označená jako dobrovolnická. Dobrovolníky na ni zvete z poolu dobrovolníků."
                  : "Akci jste založili vy, takže ji můžete označit jako dobrovolnickou."}
            </p>
          </div>
          {!(isVolunteering && locked) && (
            <Button onClick={toggle} disabled={saving} variant={isVolunteering ? "outline" : "default"} className="h-11">
              {saving ? "Ukládám…" : isVolunteering ? "Odebrat označení" : "Označit jako dobrovolnickou"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
