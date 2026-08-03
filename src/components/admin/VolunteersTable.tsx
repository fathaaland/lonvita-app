"use client";

import { useEffect, useMemo, useState } from "react";
import { getVolunteers, VolunteerRow } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { HandHeart, Mail, Phone, Search } from "lucide-react";
import { VOLUNTEER_FOCUS_OPTIONS } from "@/components/VolunteerCard";

const focusLabel = (v: string) =>
  VOLUNTEER_FOCUS_OPTIONS.find((o) => o.value === v)?.label ?? v;

export function VolunteersTable() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<VolunteerRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!profile?.municipality_id) return;
      setLoading(true);
      const list = await getVolunteers(profile.municipality_id);
      setRows(list);
      setLoading(false);
    })();
  }, [profile?.municipality_id]);

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
                  <p className="font-bold">{r.full_name}</p>
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
