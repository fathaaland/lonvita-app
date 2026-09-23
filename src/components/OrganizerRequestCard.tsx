"use client";

import { useEffect, useState } from "react";
import { getMyOrganizerRequests, requestOrganizerRole, RequestStatus } from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { ORGANIZER_REASON_MAX_LENGTH, ORGANIZER_REASON_MIN_LENGTH } from "@/lib/validation";
import {
  ORGANIZATION_NAME_MAX_LENGTH,
  ORGANIZATION_NAME_MIN_LENGTH,
  ORGANIZATION_TYPES,
  OrganizationType,
} from "@/lib/organizations";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Megaphone, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";

const ORGANIZATION_NAME_PLACEHOLDERS: Record<OrganizationType, string> = {
  business: "Např. Kavárna NMNM",
  association: "Např. TJ Sokol Nové Město",
  individual: "Např. Vycházky pro seniory, nebo vaše jméno",
};

export function OrganizerRequestCard() {
  const { user, profile, isOrganizer, isSuperAdmin } = useAuth();
  const [status, setStatus] = useState<RequestStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [reason, setReason] = useState("");
  const reasonLength = reason.trim().length;
  // Who they'll organize as — every organizer gets an organization (Organizations.ts); someone
  // without a business or club is just an "individual".
  const [organizationType, setOrganizationType] = useState<OrganizationType>("business");
  const [organizationName, setOrganizationName] = useState("");
  const nameLength = organizationName.trim().length;
  const canSubmit = reasonLength >= ORGANIZER_REASON_MIN_LENGTH && nameLength >= ORGANIZATION_NAME_MIN_LENGTH;

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
    if (!user || !profile?.municipality_id || !canSubmit) return;
    setSubmitting(true);
    try {
      await requestOrganizerRole(String(user.id), profile.municipality_id, reason.trim(), {
        name: organizationName.trim(),
        type: organizationType,
      });
      setStatus("pending");
      setFormOpen(false);
      setReason("");
      setOrganizationName("");
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
            {formOpen ? (
              <div className="space-y-2">
                <Label>Za koho budete akce pořádat?</Label>
                <div className="flex flex-wrap gap-2">
                  {ORGANIZATION_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setOrganizationType(t.value)}
                      className={cn(
                        "px-3 py-2 rounded-full text-sm font-semibold border-[1.5px] transition-colors",
                        organizationType === t.value
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-foreground border-border hover:border-brand-purple",
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
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
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    className="h-11"
                    onClick={() => setFormOpen(false)}
                    disabled={submitting}
                  >
                    Zpět
                  </Button>
                  <Button
                    onClick={handleRequest}
                    disabled={submitting || !canSubmit}
                    className="flex-1 h-11"
                  >
                    Odeslat žádost
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
