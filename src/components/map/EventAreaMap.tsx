"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { Circle, CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";

import "leaflet/dist/leaflet.css";
import { MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from "@/lib/map";

import { EVENT_AREA_COLOURS } from "./eventAreaColours";

import type { EventAreaMap as EventAreaMapData, EventAreaPoint } from "@/lib/events/area";


const colourOf = (e: EventAreaPoint) => (e.outside ? EVENT_AREA_COLOURS.outside : EVENT_AREA_COLOURS[e.runBy]);

const centreIcon = L.divIcon({
  html: '<div style="width:14px;height:14px;transform:rotate(45deg);background:#111827;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>',
  className: "",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

/** Every radius whole, and every event — even the ones far outside them. */
function FitToArea({ data }: { data: EventAreaMapData }) {
  const map = useMap();
  useEffect(() => {
    let bounds: L.LatLngBounds | null = null;
    for (const a of data.areas) {
      const b = L.latLng(a.lat, a.lng).toBounds(a.radiusKm * 2000);
      bounds = bounds ? bounds.extend(b) : b;
    }
    for (const e of data.events) {
      if (bounds) bounds.extend([e.lat, e.lng]);
      else bounds = L.latLngBounds([[e.lat, e.lng]]);
    }
    if (bounds) map.fitBounds(bounds, { padding: [24, 24] });
  }, [map, data]);
  return null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Superadmin: the contractual radii of an obec or a mikroregion and where its published, coming
 * events take place. A standalone event is a solid dot, a mikroregionální one a ring. */
export default function EventAreaMap({ data, className }: { data: EventAreaMapData; className?: string }) {
  // Outside ones drawn last, so they're on top where they overlap.
  const events = useMemo(() => [...data.events].sort((a, b) => Number(a.outside) - Number(b.outside)), [data.events]);
  const first = data.areas[0] ?? { lat: 49.8, lng: 15.5 };

  return (
    <div className={className ?? "h-[26rem] w-full rounded-xl overflow-hidden border border-border"}>
      <MapContainer center={[first.lat, first.lng]} zoom={10} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} maxZoom={19} />
        <FitToArea data={data} />
        {data.areas.map((a) => (
          <Circle
            key={a.id}
            center={[a.lat, a.lng]}
            radius={a.radiusKm * 1000}
            pathOptions={{
              color: "#111827",
              weight: a.inScope ? 2 : 1,
              dashArray: "6 6",
              fillColor: "#111827",
              fillOpacity: a.inScope ? 0.05 : 0.02,
              opacity: a.inScope ? 1 : 0.5,
            }}
          />
        ))}
        {data.areas.map((a) => (
          <Marker key={`c${a.id}`} position={[a.lat, a.lng]} icon={centreIcon}>
            <Tooltip direction="top" offset={[0, -8]}>
              {a.name} — střed, okruh {a.radiusKm} km
            </Tooltip>
          </Marker>
        ))}
        {events.map((e) => {
          const regional = e.kind === "regional";
          return (
            <CircleMarker
              key={e.id}
              center={[e.lat, e.lng]}
              radius={regional ? 9 : e.outside ? 8 : 6}
              pathOptions={
                regional
                  ? { color: colourOf(e), weight: 4, fillColor: colourOf(e), fillOpacity: 0.15 }
                  : { color: "white", weight: 2, fillColor: colourOf(e), fillOpacity: 1 }
              }
            >
              <Popup>
                <div className="space-y-0.5 text-sm">
                  <a href={`/akce/${e.id}`} className="font-semibold underline">
                    {e.title}
                  </a>
                  <div>{when(e.dateTime)}</div>
                  {e.locationText && <div>{e.locationText}</div>}
                  <div>{e.runBy === "obec" ? "Pořádá obec" : `Pořádá ${e.organizationName ?? "pořadatel"}`}</div>
                  {regional && (
                    <div>
                      Mikroregionální: {[e.homeObec, ...e.partners].join(", ")}
                    </div>
                  )}
                  <div style={{ color: e.outside ? EVENT_AREA_COLOURS.outside : undefined }}>
                    {e.distanceKm.toLocaleString("cs-CZ")} km od obce {e.nearestObec}
                    {e.outside ? " — mimo okruh" : ""}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
