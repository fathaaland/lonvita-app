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
