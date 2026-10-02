"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HandHeart, Mail, MapPinned, Phone, Search, Send, X } from "lucide-react";
import { toast } from "sonner";
import { getVolunteers, VolunteerRow, removeVolunteer } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { focusLabel } from "@/components/VolunteerCard";
import { InviteVolunteerDialog } from "@/components/InviteVolunteerDialog";
import { VolunteerMapDialog } from "@/components/VolunteerMapDialog";
import { RatingBadge } from "@/components/RatingStars";
import { UserAvatar } from "@/components/UserAvatar";

const volunteersLabel = (n: number) => (n === 1 ? "1 dobrovolník" : n < 5 ? `${n} dobrovolníci` : `${n} dobrovolníků`);

/** The volunteer pool — one for the whole platform, the same for every organizer and obec admin.
 * "Najít dobrovolníka" opens it as a map; below, the whole list to search. Each volunteer's contact
 * shows only on the channels they allowed. Joining is only ever the volunteer's own; a platform
 * admin, or an admin of the obec they help in, may take someone off. */
export function VolunteersTable() {
  const { user } = useAuth();
  const viewerId = user ? String(user.id) : null;
  const [rows, setRows] = useState<VolunteerRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [inviting, setInviting] = useState<VolunteerRow | null>(null);

  useEffect(() => {
    // 403 when the viewer organizes nowhere — show an empty pool.
    getVolunteers()
      .catch(() => [] as VolunteerRow[])
      .then((list) => {
        setRows(list);
        setLoading(false);
      });
  }, []);

  const handleRemove = async (row: VolunteerRow) => {
    setBusyId(row.id);
    try {
      await removeVolunteer(row.user_id);
      toast.success("Dobrovolník odebrán z poolu.");
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch {
      toast.error("Nepodařilo se odebrat dobrovolníka.");
    } finally {
      setBusyId(null);
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.full_name.toLowerCase().includes(needle) ||
        (r.location?.name ?? "").toLowerCase().includes(needle) ||
        (r.volunteer_focus ?? []).some((f) => focusLabel(f).toLowerCase().includes(needle)) ||
        (r.volunteer_note ?? "").toLowerCase().includes(needle),
    );
  }, [rows, q]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-3">
            <HandHeart className="h-6 w-6 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="font-bold text-lg leading-tight">Pool dobrovolníků</p>
              <p className="text-sm text-muted-foreground">
                {loading ? "Načítám…" : `${volunteersLabel(rows.length)} z celé Lonvity`}
              </p>
            </div>
          </div>
          <Button className="h-11 sm:px-5" onClick={() => setMapOpen(true)} disabled={loading || rows.length === 0}>
            <MapPinned className="h-4 w-4" /> Najít dobrovolníka
          </Button>
        </CardContent>
      </Card>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Hledat jméno, obec, oblast, poznámku…"
          aria-label="Hledat v poolu dobrovolníků"
          className="pl-9 h-11"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">
          {loading ? "" : rows.length === 0 ? "Zatím se nikdo do poolu nepřihlásil." : "Nikdo takový v poolu není."}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => (
            <li key={r.id}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <UserAvatar
                      name={r.full_name}
                      src={r.avatar_url}
                      className="h-11 w-11 shrink-0"
                      fallbackClassName="bg-primary-soft text-brand-purple-dark font-bold"
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <div className="min-w-0">
                          <Link href={`/dobrovolnik/${r.user_id}`} className="font-bold hover:underline">
                            {r.full_name}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {r.location ? `Pomáhá v obci ${r.location.name}` : "Zatím bez obce"}
                            {r.volunteer_since && ` · od ${new Date(r.volunteer_since).toLocaleDateString("cs-CZ")}`}
                          </p>
                        </div>
                        <RatingBadge rating={r.rating} />
                      </div>
                      {(r.volunteer_focus ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {(r.volunteer_focus ?? []).map((f) => (
                            <Badge key={f} variant="secondary">
                              {focusLabel(f)}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {r.volunteer_note && <p className="text-sm text-foreground/80">„{r.volunteer_note}“</p>}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        {r.phone && (
                          <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1.5 text-primary">
                            <Phone className="h-3.5 w-3.5" aria-hidden />
                            {r.phone}
                          </a>
                        )}
                        {r.email && (
                          <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1.5 text-primary break-all">
                            <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            {r.email}
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {r.user_id !== viewerId && (
                        <Button size="sm" variant="outline" className="h-9" onClick={() => setInviting(r)}>
                          <Send className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Pozvat</span>
                          <span className="sr-only sm:hidden">Pozvat {r.full_name} na akci</span>
                        </Button>
                      )}
                      {r.can_remove && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9 text-destructive"
                          disabled={busyId === r.id}
                          onClick={() => handleRemove(r)}
                          aria-label={`Odebrat ${r.full_name} z poolu`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <VolunteerMapDialog
        open={mapOpen}
        onOpenChange={setMapOpen}
        volunteers={rows}
        viewerId={viewerId}
        onInvite={(v) => setInviting(v)}
      />
      <InviteVolunteerDialog volunteer={inviting} onOpenChange={(open) => !open && setInviting(null)} />
    </div>
  );
}
