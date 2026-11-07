/** Colours of the superadmin's event-area map (EventAreaMap) and its legend — apart from the map
 * itself, so the legend doesn't pull Leaflet (which needs `window`) into the server render. */
export const EVENT_AREA_COLOURS = {
  obec: "#2563eb",
  organizer: "#16a34a",
  outside: "#dc2626",
} as const;
