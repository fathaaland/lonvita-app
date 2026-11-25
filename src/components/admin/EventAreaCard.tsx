"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPinned } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Loading } from "@/components/Loading";
import { EVENT_AREA_COLOURS } from "@/components/map/eventAreaColours";
import { EventAreaMap } from "@/components/map/EventAreaMapClient";
import { getEventAreaMap, getRegionEventAreaMap, type EventAreaMap as EventAreaMapData } from "@/integrations/payload/billing-queries";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", year: "numeric" });

function Dot({ colour }: { colour: string }) {
  return <span className="inline-block h-3 w-3 rounded-full border-2 border-white shadow" style={{ background: colour }} aria-hidden />;
}

/**
 * Superadmin: where the published, coming events of an obec — or of all obce of a mikroregion —
 * take place against the contractual radii (lib/events/area). Nothing is blocked — the obec and its pořadatelé undertake in the contract to
 * keep their events around the obec; this is how the platform checks it.
 */
export function EventAreaCard(props: { municipalityId: string } | { microregionId: string }) {
  const municipalityId = "municipalityId" in props ? props.municipalityId : null;
  const microregionId = "microregionId" in props ? props.microregionId : null;
  const [data, setData] = useState<EventAreaMapData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    (municipalityId ? getEventAreaMap(municipalityId) : getRegionEventAreaMap(microregionId!))
      .then((d) => active && setData(d))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [municipalityId, microregionId]);

  const outside = data?.events.filter((e) => e.outside) ?? [];

  return (
    <Card id="mapa-akci">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MapPinned className="h-5 w-5 text-primary" />
            <p className="font-bold">Kde se konají akce</p>
          </div>
          {data && (
            <span className={outside.length > 0 ? "text-sm font-semibold text-destructive" : "text-sm text-muted-foreground"}>
              {outside.length > 0 ? `${outside.length} mimo okruh` : "Vše v okruhu"}
            </span>
          )}
        </div>

        {failed ? (
          <p className="text-sm text-destructive">Mapu akcí se nepodařilo načíst.</p>
        ) : !data ? (
          <Loading />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Zveřejněné akce {microregionId ? "mikroregionu" : "obce"} {data.title}, které ještě neskončily ({data.events.length}).
              Přerušované kruhy jsou smluvní okruhy obcí ({data.areas.map((a) => `${a.name} ${a.radiusKm} km`).join(", ")}) — aplikace akce
              mimo ně nezakazuje, obec se ve smlouvě zavazuje pořádat je v okolí. Samostatná akce se měří od své obce, mikroregionální
              (spolupořádaná jinou obcí) od kterékoli zúčastněné obce; členství v mikroregionu samo o sobě právo pořádat jinde nedává.
            </p>
            <EventAreaMap data={data} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Dot colour={EVENT_AREA_COLOURS.obec} /> akce obce</span>
              <span className="flex items-center gap-1.5"><Dot colour={EVENT_AREA_COLOURS.organizer} /> akce pořadatelů</span>
              <span className="flex items-center gap-1.5"><Dot colour={EVENT_AREA_COLOURS.outside} /> mimo okruh</span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full border-[3px] border-muted-foreground" aria-hidden /> kroužek = mikroregionální akce
              </span>
            </div>

            {outside.length > 0 && (
              <div className="overflow-x-auto">
                <Table className="w-full text-sm">
                  <TableHeader className="text-left text-xs text-muted-foreground">
                    <TableRow>
                      <TableHead className="h-auto py-1.5 pr-3 font-medium">Akce</TableHead>
                      <TableHead className="h-auto py-1.5 pr-3 font-medium">Kdy</TableHead>
                      <TableHead className="h-auto py-1.5 pr-3 font-medium">Pořádá</TableHead>
                      <TableHead className="h-auto py-1.5 pr-3 font-medium">Druh</TableHead>
                      <TableHead className="h-auto py-1.5 pr-3 font-medium">Místo</TableHead>
                      <TableHead className="h-auto py-1.5 font-medium text-right">Od obce</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {outside
                      .slice()
                      .sort((a, b) => b.distanceKm - a.distanceKm)
                      .map((e) => (
                        <TableRow key={e.id} className="align-top">
                          <TableCell className="py-2 pr-3">
                            <Link href={`/akce/${e.id}`} className="underline">
                              {e.title}
                            </Link>
                          </TableCell>
                          <TableCell className="py-2 pr-3 whitespace-nowrap">{when(e.dateTime)}</TableCell>
                          <TableCell className="py-2 pr-3">{e.runBy === "obec" ? "Obec" : (e.organizationName ?? "Pořadatel")}</TableCell>
                          <TableCell className="py-2 pr-3">
                            {e.kind === "regional" ? `Mikroregionální (${[e.homeObec, ...e.partners].join(", ")})` : `Samostatná (${e.homeObec})`}
                          </TableCell>
                          <TableCell className="py-2 pr-3 max-w-[16rem]">{e.locationText ?? "—"}</TableCell>
                          <TableCell className="py-2 text-right tabular-nums whitespace-nowrap text-destructive">
                            {e.distanceKm.toLocaleString("cs-CZ")} km
                            <span className="block text-xs text-muted-foreground">{e.nearestObec}</span>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
