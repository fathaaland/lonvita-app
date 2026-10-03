"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Store, Users } from "lucide-react";
import { getMunicipalityOrganizers, type OrganizerProfileRow } from "@/integrations/payload/queries";
import { OrganizationMark } from "@/components/EventCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const othersLabel = (n: number) =>
  n === 0
    ? "Zatím tu nikdo další akce nepořádá"
    : n === 1
      ? "1 další pořadatel"
      : n <= 4
        ? `${n} další pořadatelé`
        : `${n} dalších pořadatelů`;

/** The way from an organization's own page to everyone else organizing in its obec — their
 * profiles live on /organizace/organizatori. A few of their marks hint at who's there. */
export function OrganizersDirectoryCard({
  municipalityId,
  municipalityName,
  organizationId,
}: {
  municipalityId: string;
  municipalityName: string;
  /** The organization the page shows — not counted among the others. */
  organizationId: string;
}) {
  const [others, setOthers] = useState<OrganizerProfileRow[] | null>(null);

  useEffect(() => {
    let active = true;
    setOthers(null);
    getMunicipalityOrganizers(municipalityId)
      .then((rows) => active && setOthers(rows.filter((o) => o.id !== organizationId)))
      .catch(() => active && setOthers([]));
    return () => {
      active = false;
    };
  }, [municipalityId, organizationId]);

  return (
    <Card>
      <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-3 min-w-0">
          <Store className="h-6 w-6 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="font-bold text-lg leading-tight">Organizátoři v obci {municipalityName}</p>
            <p className="text-sm text-muted-foreground">{others === null ? "Načítám…" : othersLabel(others.length)}</p>
          </div>
          {others && others.length > 0 && (
            <div className="ml-auto hidden sm:flex -space-x-2 pr-2" aria-hidden>
              {others.slice(0, 4).map((o) => (
                <OrganizationMark key={o.id} organization={o} className="h-9 w-9 text-xs" />
              ))}
            </div>
          )}
        </div>
        <Button asChild className="h-11 sm:px-5">
          <Link href={`/organizace/organizatori?obec=${municipalityId}`}>
            <Users className="h-4 w-4" /> Zobrazit organizátory
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
