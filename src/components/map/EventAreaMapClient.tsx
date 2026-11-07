"use client";

import dynamic from "next/dynamic";
import { Loading } from "@/components/Loading";

// Leaflet touches `window` at import time — must never render during SSR.
export const EventAreaMap = dynamic(() => import("./EventAreaMap"), {
  ssr: false,
  loading: () => <div className="h-[26rem] w-full rounded-xl border border-border flex items-center justify-center"><Loading /></div>,
});
