"use client";

import { useEffect, useState } from "react";
import {
  getMunicipality,
  getMyOrganizerRequests,
  requestOrganizerRole,
  RequestStatus,
  withdrawOrganizerRequest,
} from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { ORGANIZER_REASON_MAX_LENGTH, ORGANIZER_REASON_MIN_LENGTH } from "@/lib/validation";
import {
  ORGANIZATION_NAME_MAX_LENGTH,
  ORGANIZATION_NAME_MIN_LENGTH,
  ORGANIZATION_TYPES,
  OrganizationType,
} from "@/lib/organizations";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/ConfirmActionButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ORGANIZER_ROLE_KIND } from "@/lib/organizer-request-kinds";
import { Megaphone, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";

const ORGANIZATION_NAME_PLACEHOLDERS: Record<OrganizationType, string> = {
  business: "Např. Kavárna NMNM",
  association: "Např. TJ Sokol Nové Město",
  individual: "Např. Vycházky pro seniory, nebo vaše jméno",
};

export function OrganizerRequestCard() {
  const { user, profile, isSuperAdmin, organizerMunicipalityIds, administeredMunicipalityIds } = useAuth();
  const [status, setStatus] = useState<RequestStatus | null>(null);
  // The waiting request, so its applicant can take it back.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // The home obec founds its events itself ("municipality_only") — nobody asks to organize there.
  const [obecOnly, setObecOnly] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [reason, setReason] = useState("");
  const reasonLength = reason.trim().length;
  // Who they'll organize as — every organizer gets an organization (Organizations.ts); someone
  // without a business or club is just an "individual".
  const [organizationType, setOrganizationType] = useState<OrganizationType>("business");
  const [organizationName, setOrganizationName] = useState("");
  // Ask for the obec's (and its mikroregion's) volunteer pool too — the obec may approve the role alone.
  const [volunteerAccess, setVolunteerAccess] = useState(false);
  const nameLength = organizationName.trim().length;
  const canSubmit = reasonLength >= ORGANIZER_REASON_MIN_LENGTH && nameLength >= ORGANIZATION_NAME_MIN_LENGTH;

  useEffect(() => {
    if (!user || !profile?.municipality_id) return;
    Promise.all([getMyOrganizerRequests(String(user.id)), getMunicipality(profile.municipality_id)]).then(([reqs, home]) => {
      const forHome = reqs.find((r) => r.municipality_id === profile.municipality_id && r.kind === ORGANIZER_ROLE_KIND);
      setStatus(forHome?.status ?? null);
      setPendingId(forHome?.status === "pending" ? forHome.id : null);
      setObecOnly(home?.rules_for_creation === "municipality_only");
      setLoading(false);
    });
  }, [user, profile?.municipality_id]);

  // Already organizing in their own obec (or administering it), or platform superadmin — nothing to
  // request. Organizing somewhere else doesn't count: the request is for the home obec.
  const home = profile?.municipality_id;
  const organizesAtHome = !!home && (organizerMunicipalityIds.includes(home) || administeredMunicipalityIds.includes(home));
  if (organizesAtHome || isSuperAdmin || loading || !home) return null;

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

  const handleRequest = async () => {
    if (!user || !profile?.municipality_id || !canSubmit) return;
    setSubmitting(true);
    try {
      const id = await requestOrganizerRole(
        String(user.id),
        profile.municipality_id,
        reason.trim(),
        { name: organizationName.trim(), type: organizationType },
        volunteerAccess,
      );
      setStatus("pending");
      // So "Stáhnout žádost" is there straight away, not only after a reload.
      setPendingId(id);
      setFormOpen(false);
      setReason("");
      setOrganizationName("");
      setVolunteerAccess(false);
      toast.success("Žádost odeslána, obec ji vyřídí.");
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status === 400 ? error.message : "Žádost se nepodařilo odeslat.",
      );
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
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-4 w-4" /> Žádost čeká na vyřízení obcí.
            </p>
            {pendingId && (
              <ConfirmActionButton
                disabled={submitting}
                variant="ghost"
                className="w-full h-11 text-muted-foreground"
                title="Stáhnout žádost o roli organizátora?"
                description="Obec ji už neuvidí. Požádat můžete později znovu."
                confirmLabel="Stáhnout žádost"
                destructive
                onConfirm={handleWithdraw}
              >
                Stáhnout žádost
              </ConfirmActionButton>
            )}
          </div>
        ) : (
          <>
            {status === "rejected" && (
              <p className="text-sm text-destructive flex items-center gap-1.5">
                <XCircle className="h-4 w-4" /> Předchozí žádost byla zamítnuta.
              </p>
            )}
            {obecOnly ? (
              <p className="text-sm text-muted-foreground">
                Akce ve vaší obci teď zakládá jen obec sama — o roli organizátora tu požádat nejde.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Chcete v obci pořádat vlastní akce? Požádejte o roli organizátora.
              </p>
            )}
            {obecOnly ? null : formOpen ? (
              <div className="space-y-2">
                <Label>Za koho budete akce pořádat?</Label>
                <ToggleGroup
                  type="single"
                  variant="chip"
                  size="chip"
                  value={organizationType}
                  onValueChange={(v) => v && setOrganizationType(v as OrganizationType)}
                >
                  {ORGANIZATION_TYPES.map((t) => (
                    <ToggleGroupItem key={t.value} value={t.value}>
                      {t.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <Input
                  aria-label="Název"
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  maxLength={ORGANIZATION_NAME_MAX_LENGTH}
                  placeholder={ORGANIZATION_NAME_PLACEHOLDERS[organizationType]}
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">
                  Pod tímhle názvem vás uvidí ostatní u vašich akcí a obec vás podle něj přidá jako spolupořadatele.
                </p>
                <Label htmlFor="organizer-reason">Proč chcete v obci pořádat akce?</Label>
                <Textarea
                  id="organizer-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={ORGANIZER_REASON_MAX_LENGTH}
                  rows={4}
                  placeholder="Např. ve městě provozuji kavárnu a chci tu pořádat komunitní večery, nebo vedu místní spolek…"
                />
                <p className="text-xs text-muted-foreground">
                  Obec podle toho rozhodne, jestli žádost schválí.{" "}
                  {reasonLength < ORGANIZER_REASON_MIN_LENGTH
                    ? `Napište aspoň ${ORGANIZER_REASON_MIN_LENGTH} znaků (zatím ${reasonLength}).`
                    : `${reason.length}/${ORGANIZER_REASON_MAX_LENGTH}`}
                </p>
                <div className="flex items-center justify-between gap-3 pt-1">
                  <div>
                    <Label htmlFor="organizer-volunteer-access" className="text-sm font-semibold">
                      Požádat i o přístup k dobrovolníkům
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Abyste mohli zvát dobrovolníky z poolu obce a jejího mikroregionu a hledat je na svých akcích. Obec
                      může schválit jen roli organizátora.
                    </p>
                  </div>
                  <Switch
                    id="organizer-volunteer-access"
                    checked={volunteerAccess}
                    onCheckedChange={setVolunteerAccess}
                    disabled={submitting}
                  />
                </div>
                <div className="flex flex-col gap-2 pt-1">
                  <Button
                    onClick={handleRequest}
                    disabled={submitting || !canSubmit}
                    className="w-full h-11"
                  >
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
                Požádat o roli organizátora
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
