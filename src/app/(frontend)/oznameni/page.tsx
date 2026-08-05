"use client";

import { useEffect, useState } from "react";
import { getMyNotifications, markNotificationRead, NotificationRow } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Bell, BellOff } from "lucide-react";
import { cn } from "@/lib/utils";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

function NotificationsContent() {
  const { user } = useAuth();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    getMyNotifications(String(user.id)).then((data) => {
      setRows(data);
      setLoading(false);
    });
  }, [user]);

  const handleOpen = async (n: NotificationRow) => {
    if (n.read) return;
    setRows((prev) => prev.map((r) => (r.id === n.id ? { ...r, read: true } : r)));
    try {
      await markNotificationRead(n.id);
    } catch {
      setRows((prev) => prev.map((r) => (r.id === n.id ? { ...r, read: false } : r)));
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Oznámení" back />
      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState icon={BellOff} title="Zatím žádná oznámení" description="Sem budou chodit důležité zprávy, např. o zrušených akcích." />
      ) : (
        <div className="px-4 py-5 space-y-3">
          {rows.map((n) => (
            <Card
              key={n.id}
              className={cn("cursor-pointer transition-colors", !n.read && "border-primary/50 bg-primary-soft/40")}
              onClick={() => handleOpen(n)}
            >
              <CardContent className="p-4 flex items-start gap-3">
                <div className={cn("h-9 w-9 rounded-full flex items-center justify-center shrink-0", !n.read ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                  <Bell className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-bold">{n.title}</p>
                    {!n.read && <span className="h-2 w-2 rounded-full bg-primary shrink-0" />}
                  </div>
                  <p className="text-sm text-foreground/90 mt-0.5">{n.message}</p>
                  <p className="text-xs text-muted-foreground mt-1.5">{formatWhen(n.created_at)}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <RequireAuth>
      <NotificationsContent />
    </RequireAuth>
  );
}
