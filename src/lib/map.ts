/**
 * Where the map tiles come from — every map in the app (LocationPicker, MunicipalitiesMap) draws
 * the same ones. OpenStreetMap's own tile servers by default; their usage policy isn't meant for
 * heavy production traffic, so a deployment can point NEXT_PUBLIC_MAP_TILE_URL at another provider
 * (with its NEXT_PUBLIC_MAP_TILE_ATTRIBUTION) without a code change.
 */
export const MAP_TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL?.trim() || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export const MAP_TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION?.trim() ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
