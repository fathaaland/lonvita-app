"use client";

import { useMemo, useState } from "react";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, AlignmentType, PageOrientation,
} from "docx";
import { saveAs } from "file-saver";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Download, Copy, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  EventRow, RegistrationRow,
} from "@/lib/analytics";
import {
  ProfileWithDob, ReportMetrics, ReportRow,
  computeReportMetrics, buildReportRows,
} from "@/lib/report";

interface Props {
  events: EventRow[];
  registrations: RegistrationRow[];
  profiles: ProfileWithDob[];
  municipalityName: string;
}

interface Narrative { summary: string; whatChanged: string }

/** Deterministic, no-AI narrative built straight from the computed metrics. */
function buildNarrative(metrics: ReportMetrics, municipalityName: string): Narrative {
  const c = metrics.current;
  const p = metrics.previous;
  const delta = (a: number, b: number) => a - b;
  const eventsDelta = delta(c.eventsCount, p.eventsCount);
  const participantsDelta = delta(c.participantsUnique, p.participantsUnique);

  const summary =
    `V období ${metrics.periodFrom} – ${metrics.periodTo} proběhlo v obci ${municipalityName} ` +
    `${c.eventsCount} akcí s ${c.participantsUnique} unikátními účastníky a ${c.approvedRegistrations} ` +
    `schválenými přihláškami. Komunitní index (Datavita) je ${metrics.datavita.current}/100 a ${metrics.datavita.trend}.`;

  const whatChanged =
    `Počet akcí se oproti ${metrics.previousLabel} ${eventsDelta >= 0 ? "zvýšil" : "snížil"} o ${Math.abs(eventsDelta)}, ` +
    `počet unikátních účastníků se ${participantsDelta >= 0 ? "zvýšil" : "snížil"} o ${Math.abs(participantsDelta)}. ` +
    `Aktivních organizátorů: ${c.activeOrganizers} (${c.newOrganizers} nových). ` +
    `Datavita se za 90 dní změnila o ${metrics.datavita.delta90d >= 0 ? "+" : ""}${metrics.datavita.delta90d} bodů.`;

  return { summary, whatChanged };
}

export function CommunityReport({ events, registrations, profiles, municipalityName }: Props) {
  const [open, setOpen] = useState(false);
  const [narrative, setNarrative] = useState<Narrative | null>(null);

  const metrics = useMemo<ReportMetrics>(
    () => computeReportMetrics(events, registrations, profiles),
    [events, registrations, profiles],
  );
  const rows = useMemo<ReportRow[]>(() => buildReportRows(metrics), [metrics]);

  const generate = () => {
    setNarrative(buildNarrative(metrics, municipalityName));
    toast.success("Textové sekce vygenerovány.");
  };

  const buildMarkdown = (n: Narrative): string => {
    const dv = metrics.datavita;
    const tbl = [
      "| Metrika | Toto období | Minulé období | Změna |",
      "|---|---|---|---|",
      ...rows.map((r) => `| ${r.metric} | ${r.current} | ${r.previous} | ${r.change} |`),
    ].join("\n");
    return `# Přehled komunitního života — ${metrics.periodLabel} · ${municipalityName}

_Období: ${metrics.periodFrom} – ${metrics.periodTo}_

## Shrnutí
${n.summary}

## Klíčová čísla
${tbl}

## Co se změnilo
${n.whatChanged}

## Datavita
${dv.current}/100, ${dv.trend} (${dv.delta90d >= 0 ? "+" : ""}${dv.delta90d} bodů za 90 dní).
Participace ${dv.participation}, organizace ${dv.organization} — rozpad ukazuje, zda růst
komunity stojí především na účasti lidí, nebo na aktivitě organizátorů.

## Metodická poznámka
Data z klouzavého 90denního okna (${metrics.periodFrom} – ${metrics.periodTo}), srovnání
s předchozím 90denním oknem (${metrics.previousLabel}). Zdroj: platforma Lonvita, výpočet
proběhl ${new Date().toLocaleString("cs-CZ")}. Nezahrnuje adresy bydliště účastníků ani
údaje ze sociálně-preskripční vrstvy. Kompletní metodika Datavity dostupná na vyžádání.
`;
  };

  const copyMd = async (n: Narrative) => {
    await navigator.clipboard.writeText(buildMarkdown(n));
    toast.success("Zkopírováno jako Markdown.");
  };

  const downloadDocx = async (n: Narrative) => {
    const dv = metrics.datavita;
    const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
    const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
    const headerCell = (t: string, w: number) =>
      new TableCell({
        borders,
        width: { size: w, type: WidthType.DXA },
        shading: { fill: "F0EBE3", type: ShadingType.CLEAR, color: "auto" },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })],
      });
    const cell = (t: string, w: number) =>
      new TableCell({
        borders,
        width: { size: w, type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun(t)] })],
      });

    const widths = [3600, 1920, 1920, 1920];
    const tableRows = [
      new TableRow({
        children: [
          headerCell("Metrika", widths[0]),
          headerCell("Toto období", widths[1]),
          headerCell("Minulé období", widths[2]),
          headerCell("Změna", widths[3]),
        ],
      }),
      ...rows.map((r) => new TableRow({
        children: [
          cell(r.metric, widths[0]),
          cell(r.current, widths[1]),
          cell(r.previous, widths[2]),
          cell(r.change, widths[3]),
        ],
      })),
    ];

    const doc = new Document({
      creator: "Lonvita",
      title: `Přehled komunitního života — ${municipalityName}`,
      styles: {
        default: { document: { run: { font: "Calibri", size: 22 } } },
        paragraphStyles: [
          { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
            run: { size: 32, bold: true, font: "Calibri", color: "2F2F2F" },
            paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0 } },
          { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
            run: { size: 26, bold: true, font: "Calibri", color: "2F2F2F" },
            paragraph: { spacing: { before: 220, after: 120 }, outlineLevel: 1 } },
        ],
      },
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT },
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
        },
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1,
            children: [new TextRun(`Přehled komunitního života — ${metrics.periodLabel} · ${municipalityName}`)] }),
          new Paragraph({ children: [new TextRun({
            text: `Období: ${metrics.periodFrom} – ${metrics.periodTo}`, italics: true, color: "666666",
          })] }),

          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Shrnutí")] }),
          new Paragraph({ children: [new TextRun(n.summary)] }),

          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Klíčová čísla")] }),
          new Table({
            width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
            columnWidths: widths,
            rows: tableRows,
            alignment: AlignmentType.LEFT,
          }),

          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Co se změnilo")] }),
          new Paragraph({ children: [new TextRun(n.whatChanged)] }),

          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Datavita")] }),
          new Paragraph({ children: [new TextRun(
            `${dv.current}/100, ${dv.trend} (${dv.delta90d >= 0 ? "+" : ""}${dv.delta90d} bodů za 90 dní). ` +
            `Participace ${dv.participation}, organizace ${dv.organization} — rozpad ukazuje, zda růst ` +
            `komunity stojí především na účasti lidí, nebo na aktivitě organizátorů.`,
          )] }),

          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Metodická poznámka")] }),
          new Paragraph({ children: [new TextRun(
            `Data z klouzavého 90denního okna (${metrics.periodFrom} – ${metrics.periodTo}), srovnání ` +
            `s předchozím 90denním oknem (${metrics.previousLabel}). Zdroj: platforma Lonvita, výpočet proběhl ` +
            `${new Date().toLocaleString("cs-CZ")}. Nezahrnuje adresy bydliště účastníků ani údaje ze ` +
            `sociálně-preskripční vrstvy. Kompletní metodika Datavity dostupná na vyžádání.`,
          )] }),
        ],
      }],
    });

    const blob = await Packer.toBlob(doc);
    const fname = `report-${municipalityName.replace(/\s+/g, "-")}-${metrics.periodLabel.replace(/\s+/g, "-")}.docx`;
    saveAs(blob, fname);
    toast.success("Report stažen.");
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

          <Card>
            <CardContent className="p-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left font-bold py-1.5 pr-2">Metrika</th>
                    <th className="text-right font-bold py-1.5 px-2">Toto</th>
                    <th className="text-right font-bold py-1.5 px-2">Minulé</th>
                    <th className="text-right font-bold py-1.5 pl-2">Změna</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.metric} className="border-b last:border-0">
                      <td className="py-1.5 pr-2">{r.metric}</td>
                      <td className="text-right tabular-nums py-1.5 px-2 font-semibold">{r.current}</td>
                      <td className="text-right tabular-nums py-1.5 px-2 text-muted-foreground">{r.previous}</td>
                      <td className="text-right tabular-nums py-1.5 pl-2">{r.change}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <div className="text-xs bg-muted/50 rounded-lg p-3 space-y-1">
            <p className="font-bold">Datavita</p>
            <p>
              {metrics.datavita.current}/100 · {metrics.datavita.trend}
              {" "}({metrics.datavita.delta90d >= 0 ? "+" : ""}{metrics.datavita.delta90d} za 90 dní) ·
              participace {metrics.datavita.participation}, organizace {metrics.datavita.organization}
            </p>
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

              <div className="grid grid-cols-3 gap-2">
                <Button onClick={() => downloadDocx(narrative)} className="h-11">
                  <Download className="h-4 w-4" /> .docx
                </Button>
                <Button onClick={() => copyMd(narrative)} variant="outline" className="h-11">
                  <Copy className="h-4 w-4" /> Markdown
                </Button>
                <Button onClick={generate} variant="outline" className="h-11">
                  <Sparkles className="h-4 w-4" /> Znovu
                </Button>
              </div>

              <p className="text-[11px] text-muted-foreground leading-snug">
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
