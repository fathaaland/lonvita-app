/**
 * Datum a čas v češtině.
 */

/** The obec's time — what dates are shown and the scheduled jobs run in, whatever the server's clock says. */
export const APP_TIME_ZONE = "Europe/Prague";

const MONTHS = ["ledna", "února", "března", "dubna", "května", "června",
  "července", "srpna", "září", "října", "listopadu", "prosince"];
const WEEKDAYS = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];

// Everything here is in Prague time, whatever the clock it runs on says: the server (UTC) and the
// browser render the same text — no hydration mismatch, and a page shows the numbers its export does.

export function formatEventDate(iso: string): string {
  return formatPragueEventDate(iso);
}

export function formatEventTime(iso: string): string {
  return formatPragueEventTime(iso);
}

export function formatEventDateTime(iso: string): string {
  return `${formatEventDate(iso)} v ${formatEventTime(iso)}`;
}

export function isToday(iso: string): boolean {
  return pragueDateKey(iso) === pragueDateKey(new Date().toISOString());
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

/** Date in "YYYY-MM-DD" form (the day in Prague), suitable for an `<input type="date">`
 * value/min/max attribute. Accepts an ISO string or a Date; defaults to today. */
export function toDateInputValue(date: Date | string = new Date()): string {
  return pragueDateKey(typeof date === "string" ? date : date.toISOString());
}

/** "HH:MM" in Prague — for an `<input type="time">`. */
export function toTimeInputValue(iso: string): string {
  const p = pragueParts(iso);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Numeric date + time in the Europe/Prague timezone, e.g. "5.11.2025 14:30" — used server-side
 * (emails, notifications) where the reader's timezone can't be inferred from their browser. */
export function formatPragueDateTime(iso: string): string {
  return new Date(iso).toLocaleString("cs-CZ", {
    timeZone: APP_TIME_ZONE,
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PRAGUE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
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

/** The calendar day in Prague, "YYYY-MM-DD" — compares as a string, so `a < b` = an earlier day. */
export function pragueDateKey(iso: string): string {
  const p = pragueParts(iso);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" `days` calendar days from the given one — plain calendar arithmetic, no clock. */
export function addDaysToKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" one calendar day after the given `<input type="date">` value. */
export function nextDateInputValue(value: string): string {
  return addDaysToKey(value, 1);
}

/** The instant a Prague wall time ("YYYY-MM-DD", "HH:MM") falls on — what the event form saves,
 * whichever time zone the browser filling it in is set to. */
export function pragueWallTimeToDate(key: string, time = "00:00"): Date {
  const [year, month, day] = key.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  // Prague is UTC+1 or +2: guess, see what Prague shows for it, correct by the difference — twice,
  // for a guess that lands across a DST switch.
  let guess = target - 60 * 60 * 1000;
  for (let i = 0; i < 2; i++) {
    const p = pragueParts(new Date(guess).toISOString());
    guess += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  return new Date(guess);
}

/** Midnight in Prague of the day `date` falls on there, `days` days later. */
export function pragueStartOfDay(date: Date, days = 0): Date {
  return pragueWallTimeToDate(addDaysToKey(pragueDateKey(date.toISOString()), days));
}

/** The weekday in Prague: 0 neděle … 6 sobota. */
export function pragueWeekday(iso: string): number {
  return pragueParts(iso).weekday;
}

/** "5. 11. 2026" — the day in Prague. */
export function formatPragueDate(date: Date): string {
  const p = pragueParts(date.toISOString());
  return `${p.day}. ${p.month}. ${p.year}`;
}

/** Year, month (1–12) and day in Prague. */
export function pragueYmd(date: Date): { year: number; month: number; day: number } {
  const { year, month, day } = pragueParts(date.toISOString());
  return { year, month, day };
}

/** What a multi-day event's end has to satisfy: a later calendar day than its start — on the same
 * day it's simply an event with an end time, which the form doesn't offer. */
export const MULTI_DAY_END_MESSAGE = "Vícedenní akce musí končit nejdřív následující den po dni zahájení.";

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
  // Whole calendar days in Prague between today and the event's day.
  const [ey, em, ed] = pragueDateKey(iso).split("-").map(Number);
  const [ty, tm, td] = pragueDateKey(new Date().toISOString()).split("-").map(Number);
  const dayDiff = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(ty, tm - 1, td)) / (1000 * 60 * 60 * 24));
  if (dayDiff === 0) return "Dnes";
  if (dayDiff === 1) return "Zítra";
  if (dayDiff > 1 && dayDiff <= 6) return `Za ${dayDiff} dny`;
  if (dayDiff < 0) return "Proběhlo";
  return formatEventDate(iso).replace(/^\S+\s/, "");
}
