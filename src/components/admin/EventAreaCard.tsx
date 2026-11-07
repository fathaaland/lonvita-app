"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPinned } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Loading } from "@/components/Loading";
import { EVENT_AREA_COLOURS } from "@/components/map/eventAreaColours";
import { EventAreaMap } from "@/components/map/EventAreaMapClient";
import { getEventAreaMap, type EventAreaMap as EventAreaMapData } from "@/integrations/payload/billing-queries";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", year: "numeric" });

function Dot({ colour }: { colour: string }) {
  return <span className="inline-block h-3 w-3 rounded-full border-2 border-white shadow" style={{ background: colour }} aria-hidden />;
}

/**
 * Superadmin: where the obec's published, coming events take place against its contractual radius
 * (lib/events/area). Nothing is blocked — the obec and its pořadatelé undertake in the contract to
 * keep their events around the obec; this is how the platform checks it.
 */
export function EventAreaCard({ municipalityId }: { municipalityId: string }) {
  const [data, setData] = useState<EventAreaMapData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getEventAreaMap(municipalityId)
      .then((d) => active && setData(d))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [municipalityId]);

  const outside = data?.events.filter((e) => e.outside) ?? [];

  return (
    <Card>
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
              Zveřejněné akce obce {data.municipality.name}, které ještě neskončily ({data.events.length}). Přerušovaný kruh je smluvní
              okruh {data.municipality.radiusKm} km — aplikace akce mimo něj nezakazuje, obec se ve smlouvě zavazuje pořádat je v okolí.
              Okruh se mění v nastavení obce (pole eventRadiusKm).
            </p>
            <EventAreaMap data={data} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Dot colour={EVENT_AREA_COLOURS.obec} /> akce obce</span>
              <span className="flex items-center gap-1.5"><Dot colour={EVENT_AREA_COLOURS.organizer} /> akce pořadatelů</span>
              <span className="flex items-center gap-1.5"><Dot colour={EVENT_AREA_COLOURS.outside} /> mimo okruh</span>
            </div>

            {outside.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Akce</th>
                      <th className="py-1.5 pr-3 font-medium">Kdy</th>
                      <th className="py-1.5 pr-3 font-medium">Pořádá</th>
                      <th className="py-1.5 pr-3 font-medium">Místo</th>
                      <th className="py-1.5 font-medium text-right">Od středu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {outside
                      .slice()
                      .sort((a, b) => b.distanceKm - a.distanceKm)
                      .map((e) => (
                        <tr key={e.id} className="align-top">
                          <td className="py-2 pr-3">
                            <Link href={`/akce/${e.id}`} className="underline">
                              {e.title}
                            </Link>
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap">{when(e.dateTime)}</td>
                          <td className="py-2 pr-3">{e.runBy === "obec" ? "Obec" : (e.organizationName ?? "Pořadatel")}</td>
                          <td className="py-2 pr-3 max-w-[16rem]">{e.locationText ?? "—"}</td>
                          <td className="py-2 text-right tabular-nums whitespace-nowrap text-destructive">
                            {e.distanceKm.toLocaleString("cs-CZ")} km
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
