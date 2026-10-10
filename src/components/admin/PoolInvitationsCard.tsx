"use client";

import { useEffect, useState } from "react";
import { MailPlus, Search, X } from "lucide-react";
import { toast } from "sonner";
import {
  getPoolInvitationsForAdmin,
  inviteIntoPool,
  withdrawPoolInvitation,
  PoolInvitationAdminRow,
} from "@/integrations/payload/queries";
import { PayloadApiError } from "@/integrations/payload/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MESSAGE_MAX_LENGTH = 300;

const STATUS_LABELS: Record<PoolInvitationAdminRow["status"], string> = {
  pending: "Čeká na odpověď",
  accepted: "Přijal(a)",
  declined: "Odmítl(a)",
  withdrawn: "Staženo",
};

/** "Pozvat do poolu" — the obec's admin asks a resident to join the volunteer pool. They join
 * themselves (what they help with, how they may be reached) or say no; the admin sees the answer
 * here. Who is in the pool already, or asked, isn't offered again. */
export function PoolInvitationsCard({ municipalityId }: { municipalityId: string }) {
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<{ user_id: string; full_name: string }[]>([]);
  const [invitations, setInvitations] = useState<PoolInvitationAdminRow[]>([]);
  const [inviting, setInviting] = useState<{ user_id: string; full_name: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (query: string) => {
    try {
      const data = await getPoolInvitationsForAdmin(municipalityId, query.trim());
      setCandidates(data.candidates);
      setInvitations(data.invitations);
    } catch {
      setCandidates([]);
    }
  };

  // Searched as the admin types, a moment after they stop.
  useEffect(() => {
    if (!municipalityId) return;
    const timer = setTimeout(() => load(q), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [municipalityId, q]);

  const send = async () => {
    if (!inviting) return;
    setBusy(true);
    try {
      await inviteIntoPool(inviting.user_id, municipalityId, message);
      toast.success(`Pozvánka pro ${inviting.full_name} odeslána.`);
      setInviting(null);
      setMessage("");
      await load(q);
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Pozvánku se nepodařilo odeslat.");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (row: PoolInvitationAdminRow) => {
    setBusy(true);
    try {
      await withdrawPoolInvitation(row.id);
      toast.success("Pozvánka stažena.");
      await load(q);
    } catch (error) {
      toast.error(error instanceof PayloadApiError && error.status < 500 ? error.message : "Pozvánku se nepodařilo stáhnout.");
    } finally {
      setBusy(false);
    }
  };

  const searching = q.trim().length >= 2;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <MailPlus className="h-5 w-5 mt-0.5 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="font-bold">Pozvat do poolu</p>
            <p className="text-sm text-muted-foreground">
              Pozvěte obyvatele obce mezi dobrovolníky. Do poolu se pak přidá sám — vybere, s čím pomůže a jak ho
              pořadatelé mohou oslovit — nebo pozvánku odmítne.
            </p>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Hledat obyvatele podle jména…"
            aria-label="Hledat obyvatele obce k pozvání do poolu"
            className="pl-9 h-11"
          />
        </div>

        {searching &&
          (candidates.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-2">
              Nikoho takového k pozvání nevidíme — je už v poolu, pozvaný, nebo nebydlí v obci.
            </p>
          ) : (
            <ul className="space-y-2">
              {candidates.map((c) => (
                <li key={c.user_id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <span className="font-medium truncate">{c.full_name}</span>
                  <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={() => setInviting(c)}>
                    Pozvat
                  </Button>
                </li>
              ))}
            </ul>
          ))}

        {invitations.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Pozvánky</p>
            <ul className="space-y-2">
              {invitations.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{row.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleDateString("cs-CZ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant={row.status === "accepted" ? "default" : "secondary"}>{STATUS_LABELS[row.status]}</Badge>
                    {row.status === "pending" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 text-muted-foreground"
                        disabled={busy}
                        onClick={() => withdraw(row)}
                        aria-label={`Stáhnout pozvánku pro ${row.full_name}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <Dialog open={inviting !== null} onOpenChange={(open) => !open && !busy && setInviting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pozvat {inviting?.full_name} do poolu</DialogTitle>
            <DialogDescription>
              Dostane oznámení a e-mail. Do poolu se přidá jen sám, když bude chtít.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="pool-invitation-message">Vzkaz (nepovinné)</Label>
            <Textarea
              id="pool-invitation-message"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX_LENGTH))}
              placeholder="Např. Hledáme řidiče na odvozy seniorů k lékaři."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviting(null)} disabled={busy}>
              Zrušit
            </Button>
            <Button onClick={send} disabled={busy}>
              {busy ? "Odesílám…" : "Poslat pozvánku"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
