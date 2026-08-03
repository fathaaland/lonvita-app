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
