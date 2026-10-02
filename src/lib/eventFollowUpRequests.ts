import { toast } from "sonner";
import { inviteCoOrganizer, requestVolunteerFlag } from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";

/**
 * What the event form asks for once the event is saved — the volunteering flag (for
 * `volunteerFlag`, the requester's id) and invitations for the newly picked spolupořadatelé
 * (`coOrganizationIds`), who join only once they accept. A failed request doesn't undo the save; it
 * gets its own error toast. Returns what was sent, for the success toast ("žádost … odeslána").
 */
export async function sendFollowUpRequests(
  eventId: string,
  requests: { volunteerFlag: string | null; coOrganizationIds: string[] },
): Promise<string | null> {
  const sent: string[] = [];
  if (requests.volunteerFlag) {
    try {
      await requestVolunteerFlag(eventId, requests.volunteerFlag);
      sent.push("žádost o příznak Dobrovolnictví");
    } catch {
      toast.error("Žádost o příznak Dobrovolnictví se nepodařilo odeslat.");
    }
  }
  let invited = 0;
  for (const organizationId of requests.coOrganizationIds) {
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
  if (invited > 0) sent.push(invited > 1 ? "pozvánky ke spolupořádání" : "pozvánka ke spolupořádání");
  if (sent.length === 0) return null;
  const plural = sent.length > 1 || invited > 1;
  return `${sent.join(" a ")} ${plural ? "odeslány" : "odeslána"}`;
}
