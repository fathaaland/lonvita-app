"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getVolunteers,
  VolunteerRow,
  addVolunteer,
  removeVolunteer,
  searchMunicipalityUsers,
  MunicipalityUserRow,
} from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HandHeart, Mail, Phone, Search, UserPlus, X } from "lucide-react";
import { VOLUNTEER_FOCUS_OPTIONS } from "@/components/VolunteerCard";
import { toast } from "sonner";

const focusLabel = (v: string) =>
  VOLUNTEER_FOCUS_OPTIONS.find((o) => o.value === v)?.label ?? v;

/** `municipalityId` = the administered obec on the admin dashboard; falls back to the viewer's
 * home municipality (organizer dashboard). */
export function VolunteersTable({ municipalityId }: { municipalityId?: string }) {
  const { profile } = useAuth();
  const muniId = municipalityId || profile?.municipality_id;
  const canManage = Boolean(municipalityId);
  const [rows, setRows] = useState<VolunteerRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [addQuery, setAddQuery] = useState("");
  const [addResults, setAddResults] = useState<MunicipalityUserRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!muniId) return;
    setLoading(true);
    const list = await getVolunteers(muniId);
    setRows(list);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muniId]);

  useEffect(() => {
    if (!canManage || !muniId) return;
    const handle = setTimeout(async () => {
      const results = await searchMunicipalityUsers(muniId, addQuery);
      const volunteerIds = new Set(rows.map((r) => r.user_id));
      setAddResults(results.filter((r) => !volunteerIds.has(r.id)));
    }, 250);
    return () => clearTimeout(handle);
  }, [addQuery, muniId, canManage, rows]);

  const handleAdd = async (userId: string) => {
    if (!muniId) return;
    setBusyId(userId);
    try {
      await addVolunteer(userId, muniId);
      toast.success("Dobrovolník přidán do poolu.");
      setAddQuery("");
      setAddResults([]);
      await load();
    } catch {
      toast.error("Nepodařilo se přidat dobrovolníka.");
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (row: VolunteerRow) => {
    if (!muniId) return;
    setBusyId(row.id);
    try {
      await removeVolunteer(row.user_id, muniId);
      toast.success("Dobrovolník odebrán z poolu.");
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch {
      toast.error("Nepodařilo se odebrat dobrovolníka.");
    } finally {
      setBusyId(null);
    }
  };

  const emails = useMemo(() => {
    const map: Record<string, string> = {};
    rows.forEach((r) => { if (r.email) map[r.id] = r.email; });
    return map;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      r.full_name.toLowerCase().includes(needle) ||
      (r.volunteer_focus ?? []).some((f) => focusLabel(f).toLowerCase().includes(needle)) ||
      (r.volunteer_note ?? "").toLowerCase().includes(needle)
    );
  }, [rows, q]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <HandHeart className="h-6 w-6 text-[hsl(var(--brand-purple))]" />
          <div className="flex-1">
            <p className="font-bold text-lg leading-tight">Pool dobrovolníků</p>
            <p className="text-sm text-muted-foreground">
              {loading ? "Načítám…" : `${rows.length} přihlášených dobrovolníků v obci`}
            </p>
          </div>
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <UserPlus className="h-4 w-4" /> Přidat do poolu
            </p>
            <Input
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              placeholder="Hledat jméno v obci…"
              className="h-10"
            />
            {addResults.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {addResults.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.full_name}</p>
                      {r.email && <p className="text-xs text-muted-foreground truncate">{r.email}</p>}
                    </div>
                    <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => handleAdd(r.id)}>
                      Přidat
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Hledat jméno, oblast, poznámku…"
          className="pl-9 h-11"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">
          {loading ? "" : "Zatím se nikdo do poolu nepřihlásil."}
        </p>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-3 md:hidden">
            {filtered.map((r) => (
              <Card key={r.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold">{r.full_name}</p>
                    {canManage && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 text-destructive"
                        disabled={busyId === r.id}
                        onClick={() => handleRemove(r)}
                        aria-label="Odebrat z poolu"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(r.volunteer_focus ?? []).map((f) => (
                      <Badge key={f} variant="secondary">{focusLabel(f)}</Badge>
                    ))}
                  </div>
                  {r.volunteer_note && (
                    <p className="text-sm text-foreground/80">„{r.volunteer_note}"</p>
                  )}
                  <div className="text-sm space-y-1 pt-1">
                    {r.phone && (
                      <a href={`tel:${r.phone}`} className="flex items-center gap-1.5 text-primary">
                        <Phone className="h-3.5 w-3.5" />{r.phone}
                      </a>
                    )}
                    {emails[r.id] && (
                      <a href={`mailto:${emails[r.id]}`} className="flex items-center gap-1.5 text-primary">
                        <Mail className="h-3.5 w-3.5" />{emails[r.id]}
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block">
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="p-3 font-semibold">Jméno</th>
                      <th className="p-3 font-semibold">Oblasti</th>
                      <th className="p-3 font-semibold">Kontakt</th>
                      <th className="p-3 font-semibold">Poznámka</th>
                      <th className="p-3 font-semibold">Od</th>
                      {canManage && <th className="p-3 font-semibold" />}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id} className="border-t border-border align-top">
                        <td className="p-3 font-medium">{r.full_name}</td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {(r.volunteer_focus ?? []).map((f) => (
                              <Badge key={f} variant="secondary">{focusLabel(f)}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {r.phone && (
                            <a href={`tel:${r.phone}`} className="flex items-center gap-1 text-primary">
                              <Phone className="h-3.5 w-3.5" />{r.phone}
                            </a>
                          )}
                          {emails[r.id] && (
                            <a href={`mailto:${emails[r.id]}`} className="flex items-center gap-1 text-primary">
                              <Mail className="h-3.5 w-3.5" />{emails[r.id]}
                            </a>
                          )}
                        </td>
                        <td className="p-3 max-w-xs text-foreground/80">{r.volunteer_note}</td>
                        <td className="p-3 whitespace-nowrap text-muted-foreground">
                          {r.volunteer_since ? new Date(r.volunteer_since).toLocaleDateString("cs-CZ") : "—"}
                        </td>
                        {canManage && (
                          <td className="p-3">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive"
                              disabled={busyId === r.id}
                              onClick={() => handleRemove(r)}
                              aria-label="Odebrat z poolu"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
