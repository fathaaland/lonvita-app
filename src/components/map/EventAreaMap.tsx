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

/** The radius whole, and every event — even the ones far outside it. */
function FitToArea({ data }: { data: EventAreaMapData }) {
  const map = useMap();
  useEffect(() => {
    const { lat, lng, radiusKm } = data.municipality;
    const bounds = L.latLng(lat, lng).toBounds(radiusKm * 2000);
    for (const e of data.events) bounds.extend([e.lat, e.lng]);
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [map, data]);
  return null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Superadmin: the obec's contractual radius and where its published, coming events take place. */
export default function EventAreaMap({ data, className }: { data: EventAreaMapData; className?: string }) {
  const { municipality } = data;
  // Outside ones drawn last, so they're on top where they overlap.
  const events = useMemo(() => [...data.events].sort((a, b) => Number(a.outside) - Number(b.outside)), [data.events]);

  return (
    <div className={className ?? "h-[26rem] w-full rounded-xl overflow-hidden border border-border"}>
      <MapContainer center={[municipality.lat, municipality.lng]} zoom={10} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} maxZoom={19} />
        <FitToArea data={data} />
        <Circle
          center={[municipality.lat, municipality.lng]}
          radius={municipality.radiusKm * 1000}
          pathOptions={{ color: "#111827", weight: 2, dashArray: "6 6", fillColor: "#111827", fillOpacity: 0.05 }}
        />
        <Marker position={[municipality.lat, municipality.lng]} icon={centreIcon}>
          <Tooltip direction="top" offset={[0, -8]}>
            {municipality.name} — střed, okruh {municipality.radiusKm} km
          </Tooltip>
        </Marker>
        {events.map((e) => (
          <CircleMarker
            key={e.id}
            center={[e.lat, e.lng]}
            radius={e.outside ? 8 : 6}
            pathOptions={{ color: "white", weight: 2, fillColor: colourOf(e), fillOpacity: 1 }}
          >
            <Popup>
              <div className="space-y-0.5 text-sm">
                <a href={`/akce/${e.id}`} className="font-semibold underline">
                  {e.title}
                </a>
                <div>{when(e.dateTime)}</div>
                {e.locationText && <div>{e.locationText}</div>}
                <div>
                  {e.runBy === "obec" ? "Pořádá obec" : `Pořádá ${e.organizationName ?? "pořadatel"}`}
                </div>
                <div style={{ color: e.outside ? EVENT_AREA_COLOURS.outside : undefined }}>
                  {e.distanceKm.toLocaleString("cs-CZ")} km od středu{e.outside ? " — mimo okruh" : ""}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
