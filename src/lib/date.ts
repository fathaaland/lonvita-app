/**
 * Datum a čas v češtině.
 */

const MONTHS = ["ledna", "února", "března", "dubna", "května", "června",
  "července", "srpna", "září", "října", "listopadu", "prosince"];
const WEEKDAYS = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];

export function formatEventDate(iso: string): string {
  const d = new Date(iso);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}

export function formatEventTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function formatEventDateTime(iso: string): string {
  return `${formatEventDate(iso)} v ${formatEventTime(iso)}`;
}

export function isToday(iso: string): boolean {
  const d = new Date(iso);
  const t = new Date();
  return d.toDateString() === t.toDateString();
}

export function isThisWeek(iso: string): boolean {
  const d = new Date(iso);
  const t = new Date();
  const diff = (d.getTime() - t.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 7;
}

export function isPast(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

/** Date in "YYYY-MM-DD" form, suitable for an `<input type="date">` value/min/max attribute
 * (in the browser's local timezone). Accepts an ISO string or a Date; defaults to today. */
export function toDateInputValue(date: Date | string = new Date()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("sv-SE");
}

/** Numeric date + time in the Europe/Prague timezone, e.g. "5.11.2025 14:30" — used server-side
 * (emails, notifications) where the reader's timezone can't be inferred from their browser. */
export function formatPragueDateTime(iso: string): string {
  return new Date(iso).toLocaleString("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PRAGUE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

/** The wall-clock date and time in Prague — what a server (running in UTC) has to show. */
function pragueParts(iso: string): { year: number; month: number; day: number; weekday: number; hour: number; minute: number } {
  const parts = Object.fromEntries(
    PRAGUE_PARTS.formatToParts(new Date(iso)).map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute", number>;
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return { ...parts, weekday };
}

/** formatEventDate in the Europe/Prague timezone — for text rendered on the server (link previews,
 * share images) or meant to be read elsewhere (a social post), e.g. "čtvrtek 8. října". */
export function formatPragueEventDate(iso: string): string {
  const p = pragueParts(iso);
  return `${WEEKDAYS[p.weekday]} ${p.day}. ${MONTHS[p.month - 1]}`;
}

/** formatEventTime in the Europe/Prague timezone, e.g. "18:00". */
export function formatPragueEventTime(iso: string): string {
  const p = pragueParts(iso);
  return `${p.hour}:${p.minute.toString().padStart(2, "0")}`;
}

/** When the event takes place, in Prague time: "čtvrtek 8. října v 18:00", or for a multi-day one
 * "pátek 9. října 18:00 – neděle 11. října 14:00". */
export function formatPragueEventWhen(startIso: string, endIso?: string | null): string {
  const startDate = formatPragueEventDate(startIso);
  const startTime = formatPragueEventTime(startIso);
  if (!endIso) return `${startDate} v ${startTime}`;
  const endDate = formatPragueEventDate(endIso);
  const endTime = formatPragueEventTime(endIso);
  if (startDate === endDate) return `${startDate}, ${startTime}–${endTime}`;
  return `${startDate} ${startTime} – ${endDate} ${endTime}`;
}

export function relativeDay(iso: string): string {
  const d = new Date(iso);
  const t = new Date();
  const dayDiff = Math.floor((d.setHours(0, 0, 0, 0) - t.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
  if (dayDiff === 0) return "Dnes";
  if (dayDiff === 1) return "Zítra";
  if (dayDiff > 1 && dayDiff <= 6) return `Za ${dayDiff} dny`;
  if (dayDiff < 0) return "Proběhlo";
  return formatEventDate(new Date(iso).toISOString()).replace(/^\w+\s/, "");
}
