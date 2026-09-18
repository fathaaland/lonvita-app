"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";

import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Search, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

import "leaflet/dist/leaflet.css";

export type PickedLocation = { lat: number; lng: number; label: string };

type GeocodeResult = { lat: number; lng: number; label: string };

const pinIcon = L.divIcon({
  html: `<div class="location-pin"></div>`,
  className: "location-pin-icon",
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

function RecenterOnChange({ position }: { position: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(position, map.getZoom() < 13 ? 15 : map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position[0], position[1]]);
  return null;
}

function ClickToPlace({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export type ExistingMapPoint = { id: string; name: string; lat: number; lng: number };

const existingDotIcon = (label: string) => {
  const escaped = label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return L.divIcon({
    html: `<div class="existing-marker-dot" title="${escaped}"></div>`,
    className: "existing-marker-icon",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
};

interface Props {
  value: PickedLocation | null;
  onChange: (value: PickedLocation) => void;
  /** Bias the initial map view (e.g. the organizer's municipality) before anything is picked. */
  initialCenter: [number, number];
  /** Non-interactive reference markers (e.g. already-created obce) shown on the same map so the
   * person placing a new pin can see what already exists nearby, instead of picking blind. */
  existingPoints?: ExistingMapPoint[];
}

/** Brief §4/§12 "Nahrání... zaznamenání místa skrz google maps (ROZHODNĚ NE NAPSAT LOKACI)" —
 * search an address, pick a result, then fine-adjust by dragging the pin or clicking the map.
 * Uses OpenStreetMap/Nominatim (via our /api/geocode proxy) instead of Google Maps — no API
 * key, matches the pattern already used for the municipality map. */
export function LocationPicker({ value, onChange, initialCenter, existingPoints = [] }: Props) {
  const [query, setQuery] = useState(value?.label ?? "");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 3 || query === value?.label) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.results ?? []);
        setShowResults(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const pickResult = (r: GeocodeResult) => {
    setQuery(r.label);
    setShowResults(false);
    onChange(r);
  };

  const placeAt = async (lat: number, lng: number) => {
    // Reverse geocode so the text field reflects where the pin actually landed (drag/click),
    // not the stale search-result label.
    onChange({ lat, lng, label: value?.label ?? (query || "Vybrané místo na mapě") });
    try {
      const res = await fetch(`/api/geocode/reverse?lat=${lat}&lng=${lng}`);
      const data = await res.json();
      if (data.label) {
        setQuery(data.label);
        onChange({ lat, lng, label: data.label });
      }
    } catch {
      // Keep the fallback label — not fatal, the pin position itself is still correct.
    }
  };

  const position: [number, number] = value ? [value.lat, value.lng] : initialCenter;

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setShowResults(true)}
          placeholder="Hledejte adresu nebo místo…"
          className="pl-9 h-12"
        />
        {showResults && results.length > 0 && (
          <Card className="absolute z-[1000] mt-1 w-full shadow-lg">
            <CardContent className="p-1">
              {results.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickResult(r)}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-muted transition-colors flex items-start gap-2"
                >
                  <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <span>{r.label}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <div className={cn("h-[22rem] sm:h-[28rem] w-full rounded-2xl overflow-hidden border border-border relative", !value && "opacity-90")}>
        <style>{`
          .location-pin-icon { background: transparent; border: none; }
          .location-pin { width: 22px; height: 22px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); background: hsl(var(--primary)); border: 2px solid white; box-shadow: 0 1px 4px rgba(0,0,0,0.5); }
          .existing-marker-icon { background: transparent; border: none; }
          .existing-marker-dot { width: 12px; height: 12px; border-radius: 999px; background: hsl(var(--muted-foreground)); border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
        `}</style>
        <MapContainer center={position} zoom={value ? 15 : 12} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={20}
          />
          <RecenterOnChange position={position} />
          <ClickToPlace onPlace={placeAt} />
          {existingPoints.map((p) => (
            <Marker key={p.id} position={[p.lat, p.lng]} icon={existingDotIcon(p.name)}>
              <Tooltip direction="top" offset={[0, -6]}>{p.name}</Tooltip>
            </Marker>
          ))}
          {value && (
            <Marker
              position={position}
              icon={pinIcon}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const m = e.target as L.Marker;
                  const { lat, lng } = m.getLatLng();
                  placeAt(lat, lng);
                },
              }}
            />
          )}
        </MapContainer>
        {!value && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-background/40">
            <p className="text-sm font-medium bg-card px-3 py-1.5 rounded-full shadow">Vyhledejte místo nebo klikněte na mapu</p>
          </div>
        )}
      </div>
    </div>
  );
}
