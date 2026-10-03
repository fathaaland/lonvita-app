import { toast } from "sonner";
import { inviteCoOrganizer } from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";

/**
 * What the event form sends once the event is saved — invitations for the newly picked
 * spolupořadatelé (`coOrganizationIds`), who join only once they accept. A failed invitation
 * doesn't undo the save; it gets its own error toast. Returns what was sent, for the success toast
 * ("pozvánka … odeslána").
 */
export async function sendFollowUpRequests(eventId: string, coOrganizationIds: string[]): Promise<string | null> {
  let invited = 0;
  for (const organizationId of coOrganizationIds) {
    try {
      // The obec's admin inviting the obec has consented already — that one isn't an invitation.
      if ((await inviteCoOrganizer(eventId, organizationId)).status === "pending") invited++;
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status < 500
          ? error.message
          : "Pozvánku ke spolupořádání se nepodařilo odeslat.",
      );
    }
  }
  if (invited === 0) return null;
  return invited > 1 ? "pozvánky ke spolupořádání odeslány" : "pozvánka ke spolupořádání odeslána";
}
