"use client";

import dynamic from "next/dynamic";
import { Loading } from "@/components/Loading";

// Leaflet touches `window` at import time — must never render during SSR.
export const LocationPicker = dynamic(() => import("./LocationPicker").then((m) => m.LocationPicker), {
  ssr: false,
  loading: () => <div className="h-56 w-full rounded-2xl border border-border flex items-center justify-center"><Loading /></div>,
});
