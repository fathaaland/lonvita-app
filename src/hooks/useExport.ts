"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { ExportRequestInput, ExportStatusResponse } from "@/lib/exports/contracts";

/** 1 s, 2 s, 3 s … — most exports finish within the first couple of polls. */
const POLL_STEP_MS = 1_000;
const POLL_MAX_INTERVAL_MS = 5_000;
/** After this the dialog stops waiting; the worker's export-ready job notifies the user instead. */
const POLL_TIMEOUT_MS = 60_000;

const BACKGROUND_MESSAGE = "Report se dokončí na pozadí — dáme vám vědět v notifikacích.";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const errorMessage = async (res: Response, fallback: string) => {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return res.status === 429 || res.status === 503 ? (body?.error ?? fallback) : fallback;
};

/**
 * Asks the worker for a report file, polls until it's rendered and then downloads it. Leaving the
 * page (or waiting past the timeout) doesn't lose it: the file is still generated and the
 * "report je připraven" notification links to it.
 *
 * `pending` is the key of the export in flight (e.g. "community-report:pdf"), for button spinners.
 */
export function useExport() {
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pendingRef.current) toast.info(BACKGROUND_MESSAGE);
    };
  }, []);

  const start = useCallback(async (request: ExportRequestInput) => {
    if (pendingRef.current) return;
    const key = `${request.kind}:${request.format}`;
    pendingRef.current = key;
    setPending(key);

    try {
      const res = await fetch("/api/exports", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        toast.error(await errorMessage(res, "Report se nepodařilo spustit."));
        return;
      }
      const { id } = (await res.json()) as { id: number };

      const startedAt = Date.now();
      for (let attempt = 1; Date.now() - startedAt < POLL_TIMEOUT_MS; attempt++) {
        await sleep(Math.min(attempt * POLL_STEP_MS, POLL_MAX_INTERVAL_MS));
        // Unmounted: the cleanup already told the user it continues in the background.
        if (!mounted.current) return;

        const statusRes = await fetch(`/api/exports/${id}`, { credentials: "include", cache: "no-store" });
        if (!statusRes.ok) continue;
        const status = (await statusRes.json()) as ExportStatusResponse;

        if (status.status === "done") {
          window.location.assign(`/api/exports/${id}/download`);
          toast.success("Report stažen.");
          return;
        }
        if (status.status === "failed") {
          toast.error("Report se nepodařilo vygenerovat.");
          return;
        }
      }
      toast.info(BACKGROUND_MESSAGE);
    } catch {
      if (mounted.current) toast.error("Report se nepodařilo vygenerovat.");
    } finally {
      pendingRef.current = null;
      if (mounted.current) setPending(null);
    }
  }, []);

  return { start, pending };
}
