import type { CalendarEvent, Holiday, Occurrence } from "../types";

const DAY = 86_400_000;
const pad = (value: number) => String(value).padStart(2, "0");

/** Local calendar date. Never use toISOString() to label a day in the UI. */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

export function monthDays(date: Date): Date[] {
  const first = startOfWeek(new Date(date.getFullYear(), date.getMonth(), 1));
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}

/** Calendar alignment uses empty cells, never dates belonging to another month. */
export function monthCells(date: Date): (Date | null)[] {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const leading = (first.getDay() + 6) % 7;
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const size = Math.ceil((leading + count) / 7) * 7;
  return Array.from({ length: size }, (_, index) => {
    const day = index - leading + 1;
    return day > 0 && day <= count
      ? new Date(date.getFullYear(), date.getMonth(), day)
      : null;
  });
}

/** Parse a wall time into a UTC arithmetic surrogate, independent of host DST. */
export function wallTime(value: string): number {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (!match) return NaN;
  const [, y, m, d, h = "00", min = "00", s = "00"] = match;
  const result = Date.UTC(+y, +m - 1, +d, +h, +min, +s);
  const check = new Date(result);
  return check.getUTCFullYear() === +y &&
    check.getUTCMonth() === +m - 1 &&
    check.getUTCDate() === +d &&
    check.getUTCHours() === +h &&
    check.getUTCMinutes() === +min &&
    check.getUTCSeconds() === +s
    ? result
    : NaN;
}

export function wallString(value: number): string {
  return new Date(value).toISOString().slice(0, 16);
}

function localWallTime(date: Date): number {
  return Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  );
}

function repeatTime(
  initial: number,
  index: number,
  frequency: string,
  interval: number,
): number | null {
  if (frequency === "daily" || frequency === "weekly")
    return initial + index * interval * DAY * (frequency === "weekly" ? 7 : 1);
  const date = new Date(initial);
  const day = date.getUTCDate();
  if (frequency === "monthly")
    date.setUTCMonth(date.getUTCMonth() + index * interval);
  else if (frequency === "yearly")
    date.setUTCFullYear(date.getUTCFullYear() + index * interval);
  else return index === 0 ? initial : null;
  // RFC 5545: an invalid date (31 February, 29 February in a non-leap year)
  // is skipped instead of shifted into the following month.
  return date.getUTCDate() === day ? date.getTime() : null;
}

export function getOccurrences(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): Occurrence[] {
  const from = localWallTime(rangeStart);
  const to = localWallTime(rangeEnd);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const occurrences: Occurrence[] = [];
  for (const event of events) {
    const initial = wallTime(event.start);
    const end = wallTime(event.end);
    if (!Number.isFinite(initial) || !Number.isFinite(end) || end <= initial)
      continue;
    const duration = end - initial;
    const frequency = event.recurrence?.frequency ?? "none";
    const interval = Math.max(1, Math.floor(event.recurrence?.interval || 1));
    const until = event.recurrence?.until
      ? wallTime(event.recurrence.until.slice(0, 10)) + DAY - 1
      : Infinity;
    let firstIndex = 0;
    if (frequency === "daily" || frequency === "weekly") {
      firstIndex = Math.max(
        0,
        Math.floor(
          (from - duration - initial) /
            (interval * DAY * (frequency === "weekly" ? 7 : 1)),
        ),
      );
    } else if (frequency === "monthly") {
      const earliest = new Date(from - duration);
      const original = new Date(initial);
      firstIndex = Math.max(
        0,
        Math.floor(
          ((earliest.getUTCFullYear() - original.getUTCFullYear()) * 12 +
            earliest.getUTCMonth() -
            original.getUTCMonth()) /
            interval,
        ) - 1,
      );
    } else if (frequency === "yearly") {
      firstIndex = Math.max(
        0,
        Math.floor(
          (new Date(from - duration).getUTCFullYear() -
            new Date(initial).getUTCFullYear()) /
            interval,
        ) - 1,
      );
    }
    // A view should be short; cap expansion for malformed or adversarial data.
    for (
      let index = firstIndex, attempts = 0;
      attempts < 20_000;
      index++, attempts++
    ) {
      const start = repeatTime(initial, index, frequency, interval);
      if (start === null) {
        if (frequency === "none") break;
        continue;
      }
      if (start >= to || start > until) break;
      if (start + duration > from) {
        const startString = wallString(start);
        occurrences.push({
          event,
          start: startString,
          end: wallString(start + duration),
          key: `${event.id}:${startString}`,
        });
      }
      if (frequency === "none") break;
    }
  }
  return occurrences.sort(
    (a, b) =>
      a.start.localeCompare(b.start) ||
      a.event.title.localeCompare(b.event.title, "fr"),
  );
}

export function frenchHolidays(
  year: number,
  region: "fr" | "alsace" = "fr",
): Holiday[] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easter = new Date(
    year,
    Math.floor((h + l - 7 * m + 114) / 31) - 1,
    ((h + l - 7 * m + 114) % 31) + 1,
  );
  const holiday = (date: string, name: string): Holiday => ({
    date: `${year}-${date}`,
    name,
  });
  const result = [
    holiday("01-01", "Jour de l’an"),
    { date: dateKey(addDays(easter, 1)), name: "Lundi de Pâques" },
    holiday("05-01", "Fête du Travail"),
    holiday("05-08", "Victoire de 1945"),
    { date: dateKey(addDays(easter, 39)), name: "Ascension" },
    { date: dateKey(addDays(easter, 50)), name: "Lundi de Pentecôte" },
    holiday("07-14", "Fête nationale"),
    holiday("08-15", "Assomption"),
    holiday("11-01", "Toussaint"),
    holiday("11-11", "Armistice de 1918"),
    holiday("12-25", "Noël"),
  ];
  if (region === "alsace")
    result.push(
      {
        date: dateKey(addDays(easter, -2)),
        name: "Vendredi saint (selon la commune)",
      },
      holiday("12-26", "Saint-Étienne"),
    );
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

export interface WorkEventsOptions {
  week: string;
  days: number[];
  startTime: string;
  endTime: string;
  title: string;
  categoryId: string;
  icon: string;
  alerts: number[];
  timezone: string;
}

export function buildWorkEvents(options: WorkEventsOptions): CalendarEvent[] {
  const weekTime = wallTime(options.week.slice(0, 10));
  const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (
    !Number.isFinite(weekTime) ||
    !validTime(options.startTime) ||
    !validTime(options.endTime)
  )
    throw new Error("Les dates ou horaires sont invalides.");
  if (options.startTime === options.endTime)
    throw new Error("Les heures de début et de fin doivent être différentes.");
  const dayOfWeek = new Date(weekTime).getUTCDay();
  const monday = weekTime - ((dayOfWeek + 6) % 7) * DAY;
  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  return [...new Set(options.days)]
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    .sort((a, b) => a - b)
    .map((day) => {
      const date = new Date(monday + (day - 1) * DAY)
        .toISOString()
        .slice(0, 10);
      const start = `${date}T${options.startTime}`;
      let end = `${date}T${options.endTime}`;
      if (end < start) end = wallString(wallTime(end) + DAY);
      const id = crypto.randomUUID();
      return {
        id,
        uid: `${id}@tempo.local`,
        title: options.title.trim() || "Travail",
        start,
        end,
        allDay: false,
        categoryId: options.categoryId,
        icon: options.icon,
        location: "",
        notes: "",
        url: "",
        availability: "busy",
        alerts: [...options.alerts],
        recurrence: { frequency: "none", interval: 1 },
        timezone: options.timezone,
        attachmentIds: [],
        createdAt: now,
        updatedAt: now,
        batchId,
      };
    });
}
