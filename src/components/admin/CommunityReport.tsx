"use client";

import { useMemo, useRef, useState } from "react";
import { saveAs } from "file-saver";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { FileText, Download, Copy, Sparkles, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Narrative, ReportMetrics, ReportRow,
  buildNarrative, buildReportRows, datavitaParagraph, methodologyParagraph, reportTitle,
} from "@/lib/report";
import { fileSlug } from "@/lib/exports/contracts";
import { useExport } from "@/hooks/useExport";

interface Props {
  /** Worked out on the server with the rest of the dashboard (lib/dashboard). */
  metrics: ReportMetrics;
  municipalityName: string;
  /** For the .docx/.pdf, which the worker renders from the database rather than from these props. */
  municipalityId: string;
  scope: "all" | "mine";
}

export function CommunityReport({ metrics, municipalityName, municipalityId, scope }: Props) {
  const [open, setOpen] = useState(false);
  const [narrative, setNarrative] = useState<Narrative | null>(null);
  const reportCardRef = useRef<HTMLDivElement>(null);
  const exporter = useExport();

  const rows = useMemo<ReportRow[]>(() => buildReportRows(metrics), [metrics]);

  const generate = () => {
    setNarrative(buildNarrative(metrics, municipalityName));
    toast.success("Textové sekce vygenerovány.");
  };

  const buildMarkdown = (n: Narrative): string => {
    const tbl = [
      "| Metrika | Toto období | Minulé období | Změna |",
      "|---|---|---|---|",
      ...rows.map((r) => `| ${r.metric} | ${r.current} | ${r.previous} | ${r.change} |`),
    ].join("\n");
    return `# ${reportTitle(metrics, municipalityName)}

_Období: ${metrics.periodFrom} – ${metrics.periodTo}_

## Shrnutí
${n.summary}

## Klíčová čísla
${tbl}

## Co se změnilo
${n.whatChanged}

## Datavita
${datavitaParagraph(metrics)}

## Metodická poznámka
${methodologyParagraph(metrics)}
`;
  };

  const copyMd = async (n: Narrative) => {
    await navigator.clipboard.writeText(buildMarkdown(n));
    toast.success("Zkopírováno jako Markdown.");
  };

  const requestFile = (format: "docx" | "pdf") =>
    exporter.start({ kind: "community-report", format, params: { municipalityId, scope } });

  const reportFileBase = () => `report-${fileSlug(municipalityName)}-${fileSlug(metrics.periodLabel)}`;

  const downloadJpeg = async () => {
    if (!reportCardRef.current) return;
    try {
      // Loaded on the click — a sizeable library nobody needs until they ask for the image.
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(reportCardRef.current, { scale: 2, backgroundColor: "#ffffff" });
      canvas.toBlob((blob) => {
        if (!blob) {
          toast.error("Export do JPEG se nepodařil.");
          return;
        }
        saveAs(blob, `${reportFileBase()}.jpg`);
        toast.success("Tabulka stažena jako JPEG.");
      }, "image/jpeg", 0.92);
    } catch {
      toast.error("Export do JPEG se nepodařil.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-11">
          <FileText className="h-4 w-4" /> Vygenerovat report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report o komunitě · {municipalityName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Období {metrics.periodFrom} – {metrics.periodTo}. Srovnání s {metrics.previousLabel}.
            Textové sekce se generují automaticky ze skutečných čísel v tabulce níže.
          </p>

          <Card ref={reportCardRef}>
            <CardContent className="p-3 overflow-x-auto">
              <Table className="w-full text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-auto text-left font-bold py-1.5 pr-2">Metrika</TableHead>
                    <TableHead className="h-auto text-right font-bold py-1.5 px-2">Toto</TableHead>
                    <TableHead className="h-auto text-right font-bold py-1.5 px-2">Minulé</TableHead>
                    <TableHead className="h-auto text-right font-bold py-1.5 pl-2">Změna</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.metric}>
                      <TableCell className="py-1.5 pr-2">{r.metric}</TableCell>
                      <TableCell className="text-right tabular-nums py-1.5 px-2 font-semibold">{r.current}</TableCell>
                      <TableCell className="text-right tabular-nums py-1.5 px-2 text-muted-foreground">{r.previous}</TableCell>
                      <TableCell className="text-right tabular-nums py-1.5 pl-2">{r.change}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="text-xs bg-muted/50 rounded-lg p-3 space-y-1">
            <p className="font-bold">Datavita</p>
            {metrics.datavita.current === null ? (
              <p>Nedostatek dat za toto období (potřeba alespoň 30 aktivních účastníků a 5 akcí).</p>
            ) : (
              <p>
                {metrics.datavita.current}/100 · {metrics.datavita.trend}
                {" "}({metrics.datavita.delta90d >= 0 ? "+" : ""}{metrics.datavita.delta90d} za 90 dní) ·
                participace {metrics.datavita.participation}, organizace {metrics.datavita.organization}
              </p>
            )}
          </div>

          {!narrative && (
            <Button onClick={generate} className="w-full h-12">
              <Sparkles className="h-4 w-4" /> Vygenerovat textové sekce
            </Button>
          )}

          {narrative && (
            <div className="space-y-4">
              <section className="space-y-1">
                <p className="font-bold text-sm">Shrnutí</p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{narrative.summary}</p>
              </section>
              <section className="space-y-1">
                <p className="font-bold text-sm">Co se změnilo</p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{narrative.whatChanged}</p>
              </section>

              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => requestFile("docx")} disabled={exporter.pending !== null} className="h-11">
                  {exporter.pending === "community-report:docx"
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Download className="h-4 w-4" />} .docx
                </Button>
                <Button onClick={() => requestFile("pdf")} disabled={exporter.pending !== null} className="h-11">
                  {exporter.pending === "community-report:pdf"
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Download className="h-4 w-4" />} .pdf
                </Button>
                <Button onClick={downloadJpeg} variant="outline" className="h-11">
                  <ImageIcon className="h-4 w-4" /> .jpg (tabulka)
                </Button>
                <Button onClick={() => copyMd(narrative)} variant="outline" className="h-11">
                  <Copy className="h-4 w-4" /> Markdown
                </Button>
                <Button onClick={generate} variant="outline" className="h-11 col-span-2">
                  <Sparkles className="h-4 w-4" /> Znovu
                </Button>
              </div>

              <p className="text-2xs text-muted-foreground leading-snug">
                Dokument má vrstvenou strukturu — novinář si vezme první odstavec, grant celý dokument,
                zastupitelstvo první čtyři sekce bez metodické poznámky.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
