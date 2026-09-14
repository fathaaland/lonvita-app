"use client";

import dynamic from "next/dynamic";
import { Loading } from "@/components/Loading";

// Leaflet touches `window` at import time — must never render during SSR.
export const MunicipalitiesMap = dynamic(() => import("./MunicipalitiesMap"), {
  ssr: false,
  loading: () => <div className="h-[24rem] sm:h-[36rem] w-full rounded-2xl border border-border flex items-center justify-center"><Loading /></div>,
});
