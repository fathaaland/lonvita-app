"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";

import "leaflet/dist/leaflet.css";

export type MunicipalityMapPoint = { id: string; name: string; lat: number; lng: number };

// Geographic center of the Czech Republic — a sane default when there's nothing (yet) to
// fit bounds to, or only a single municipality (fitBounds on one point is degenerate).
const CZECHIA_CENTER: [number, number] = [49.8175, 15.473];
const DEFAULT_ZOOM = 7;

function createMunicipalityIcon(label: string, active: boolean) {
  const escaped = label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return L.divIcon({
    html: `<div class="muni-marker-dot${active ? " muni-marker-dot--active" : ""}"></div><div class="muni-marker-label">${escaped}</div>`,
    className: "muni-marker-icon",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function FitToMarkers({ points }: { points: MunicipalityMapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 12);
      return;
    }
    map.fitBounds(points.map((p) => [p.lat, p.lng] as [number, number]), { padding: [32, 32] });
  }, [map, points]);
  return null;
}

// Leaflet measures its container once at mount. Inside an animated Radix Dialog, that happens
// mid zoom-in transition, so the map freezes at the wrong (smaller) size — this keeps it in sync.
function InvalidateSizeOnResize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

interface Props {
  points: MunicipalityMapPoint[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  className?: string;
}

/** Brief §4/§7 "mapka jako v Projects/eduard-app" — every municipality using Lonvita, pinned;
 * tap a pin to switch which obec's events you're browsing (brief §"uživatel není vázaný lokací"). */
export default function MunicipalitiesMap({ points, selectedId, onSelect, className }: Props) {
  const markers = useMemo(() => points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)), [points]);

  return (
    <div className={className ?? "h-[24rem] sm:h-[36rem] w-full rounded-2xl overflow-hidden border border-border"}>
      <style>{`
        .muni-marker-icon { background: transparent; border: none; }
        .muni-marker-dot { width: 14px; height: 14px; border-radius: 999px; background: hsl(var(--primary)); border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.4); cursor: pointer; }
        .muni-marker-dot--active { background: hsl(var(--accent)); width: 18px; height: 18px; margin: -2px; }
        .muni-marker-label { display: none; }
      `}</style>
      <MapContainer center={CZECHIA_CENTER} zoom={DEFAULT_ZOOM} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToMarkers points={markers} />
        <InvalidateSizeOnResize />
        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.lat, m.lng]}
            icon={createMunicipalityIcon(m.name, m.id === selectedId)}
            eventHandlers={{ click: () => onSelect(m.id) }}
          >
            <Tooltip direction="top" offset={[0, -8]}>{m.name}</Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
