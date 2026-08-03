"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  getEvent,
  getEventRegistrationsForManage,
  updateRegistrationStatus,
  ManageRegistrationRow,
} from "@/integrations/payload/queries";
import { RequireAuth, RequireRole } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Check, X, Clock } from "lucide-react";
import { toast } from "sonner";

function ManageEventContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [regs, setRegs] = useState<ManageRegistrationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!id) return;
    const [ev, rows] = await Promise.all([getEvent(id), getEventRegistrationsForManage(id)]);
    setRegs(rows);
    setLoading(false);
    void ev;
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const updateStatus = async (regId: string, status: "approved" | "rejected") => {
    try {
      await updateRegistrationStatus(regId, status);
      toast.success(status === "approved" ? "Schváleno." : "Zamítnuto.");
      load();
    } catch {
      toast.error("Nepodařilo se uložit změnu.");
    }
  };

  if (loading) return <><PageHeader title="Přihlášení" back /><Loading /></>;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Přihlášení" subtitle={`Celkem: ${regs.length}`} back />
      <div className="px-4 py-5 space-y-3">
        {regs.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Zatím nikdo není přihlášen.</p>
        ) : regs.map((r) => (
          <Card key={r.id}><CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10"><AvatarFallback className="bg-primary text-primary-foreground">
                {r.full_name.split(" ").map(p => p[0]).join("").slice(0, 2)}
              </AvatarFallback></Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">{r.full_name}</p>
                {r.phone && <p className="text-sm text-muted-foreground">{r.phone}</p>}
              </div>
              {r.status === "approved" && <Badge className="bg-success text-success-foreground">Schválen</Badge>}
              {r.status === "pending" && <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />Čeká</Badge>}
              {r.status === "rejected" && <Badge variant="destructive">Zamítnut</Badge>}
              {r.status === "cancelled" && <Badge variant="outline">Zrušeno účastníkem</Badge>}
            </div>

            {r.status === "pending" && (
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => updateStatus(r.id, "approved")} className="h-11"><Check className="h-4 w-4" />Schválit</Button>
                <Button onClick={() => updateStatus(r.id, "rejected")} variant="outline" className="h-11">
                  <X className="h-4 w-4" />Zamítnout
                </Button>
              </div>
            )}
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}

export default function ManageEventPage() {
  return (
    <RequireAuth>
      <RequireRole role="organizer">
        <ManageEventContent />
      </RequireRole>
    </RequireAuth>
  );
}
