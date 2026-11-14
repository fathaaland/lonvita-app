"use client";

import { Archive, Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useExport } from "@/hooks/useExport";

/** Everything of the obec as a ZIP of CSVs (lib/exports/municipality-archive) — any time, and what it
 * takes along when its contract ends. */
export function MunicipalityDataExportCard({ municipalityId }: { municipalityId: string }) {
  const exporter = useExport();
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Archive className="h-5 w-5 text-primary" />
          <p className="font-bold">Všechna data obce</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Akce, přihlášky s docházkou, organizace a role v obci jako tabulky CSV v jednom archivu ZIP.
        </p>
        <Button
          variant="outline"
          className="h-11"
          disabled={exporter.pending !== null}
          onClick={() => exporter.start({ kind: "municipality-archive", format: "zip", params: { municipalityId } })}
        >
          {exporter.pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Stáhnout data obce
        </Button>
      </CardContent>
    </Card>
  );
}
