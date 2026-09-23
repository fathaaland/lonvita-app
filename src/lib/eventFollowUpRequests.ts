import { toast } from "sonner";
import { requestObecCoOrganizing, requestVolunteerFlag } from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";

/**
 * What the event form's checkboxes ask the obec for once the event is saved — the volunteering
 * flag (for `volunteerFlag`, the requester's id) and co-organizing. A failed request doesn't undo the
 * save; it gets its own error toast. Returns what was sent, for the success toast ("žádost … odeslána").
 */
export async function sendFollowUpRequests(
  eventId: string,
  requests: { volunteerFlag: string | null; obecCoOrganizing: boolean },
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
  if (requests.obecCoOrganizing) {
    try {
      await requestObecCoOrganizing(eventId);
      sent.push("žádost obci o spolupořádání");
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status < 500
          ? error.message
          : "Žádost obci o spolupořádání se nepodařilo odeslat.",
      );
    }
  }
  if (sent.length === 0) return null;
  return `${sent.join(" a ")} ${sent.length > 1 ? "odeslány" : "odeslána"}`;
}
