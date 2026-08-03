/** Minimal RFC 5545 .ics builder — just enough for "add this event to my calendar". */

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000; // events don't model an end time yet

function toIcsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

/** Escapes TEXT property values per RFC 5545 §3.3.11. */
function escapeText(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

/** Folds a line to 75 octets as RFC 5545 requires, continuation lines start with a space. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  parts.push(rest);
  return parts.join("\r\n");
}

export interface IcsEventInput {
  uid: string;
  title: string;
  description?: string;
  location: string;
  startsAt: string; // ISO
  durationMs?: number;
}

export function buildIcsEvent(input: IcsEventInput): string {
  const start = new Date(input.startsAt);
  const end = new Date(start.getTime() + (input.durationMs ?? DEFAULT_DURATION_MS));

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lonvita//Akce//CS",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}@lonvita.cz`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeText(input.title)}`,
    `LOCATION:${escapeText(input.location)}`,
    ...(input.description ? [`DESCRIPTION:${escapeText(input.description)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
