"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMyNotifications, markAllNotificationsRead, markNotificationRead, NotificationRow } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { notifyUnreadCountChanged } from "@/hooks/useUnreadNotificationCount";
import { RequireAuth } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Bell, BellOff, CheckCheck, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

function NotificationsContent() {
  const { user } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    if (!user) return;
    getMyNotifications(String(user.id)).then((data) => {
      setRows(data);
      setLoading(false);
    });
  }, [user]);

  const handleOpen = (n: NotificationRow) => {
    if (!n.read) {
      setRows((prev) => prev.map((r) => (r.id === n.id ? { ...r, read: true } : r)));
      markNotificationRead(n.id)
        .then(notifyUnreadCountChanged)
        .catch(() => {
          setRows((prev) => prev.map((r) => (r.id === n.id ? { ...r, read: false } : r)));
        });
    }
    // e.g. "Nová přihláška na akci" -> that event's detail. An API link (a finished export's
    // download) isn't a page the client router can render — it needs a real navigation.
    if (n.link?.startsWith("/api/")) window.location.assign(n.link);
    else if (n.link) router.push(n.link);
  };

  const handleMarkAll = () => {
    if (!user) return;
    setMarkingAll(true);
    markAllNotificationsRead(String(user.id))
      .then(() => {
        setRows((prev) => prev.map((r) => ({ ...r, read: true })));
        notifyUnreadCountChanged();
      })
      .catch(() => toast.error("Oznámení se nepodařilo označit. Zkuste to prosím znovu."))
      .finally(() => setMarkingAll(false));
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
          {/* The page lists only the newest 100, so this also clears older unread ones. */}
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={handleMarkAll} disabled={markingAll}>
              <CheckCheck className="h-4 w-4" />
              Označit vše jako přečtené
            </Button>
          </div>
          {rows.map((n) => (
            <Card
              key={n.id}
              className={cn(
                "transition-colors",
                (n.link || !n.read) && "cursor-pointer",
                n.link && "hover:border-primary/50",
                !n.read && "border-primary/50 bg-primary-soft/40",
              )}
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
                {n.link && <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 self-center" />}
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
