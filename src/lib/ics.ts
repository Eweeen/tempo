import type { CalendarEvent, Recurrence } from "../types";
import { wallString, wallTime } from "./calendar";

// Interchange follows RFC 5545. Attachments intentionally remain in IndexedDB.
const escapeText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
const unescapeText = (value: string) =>
  value.replace(/\\([nN,;\\])/g, (_, char: string) =>
    char.toLowerCase() === "n" ? "\n" : char,
  );
const compact = (value: string) =>
  `${value.slice(0, 16).replace(/[-:]/g, "")}00`;
const compactUTC = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
const supportedZone = (zone: string) =>
  zone === "UTC" || zone === "Europe/Paris";

/** Fold by UTF-8 octets, without cutting a Unicode code point. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      lines.push(current);
      current = " ";
      bytes = 1;
    }
    current += character;
    bytes += size;
  }
  lines.push(current);
  return lines.join("\r\n");
}

function offsetMinutes(time: number, timezone: string): number {
  if (timezone === "UTC") return 0;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(time));
  const get = (name: string) =>
    Number(parts.find((part) => part.type === name)?.value);
  return (
    (Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    ) -
      time) /
    60_000
  );
}

export function wallToUTC(value: string, timezone: string): number {
  const wall = wallTime(value);
  if (!Number.isFinite(wall)) return NaN;
  if (timezone === "UTC") return wall;
  const before = offsetMinutes(wall - 86_400_000, timezone);
  const after = offsetMinutes(wall + 86_400_000, timezone);
  const candidates = [...new Set([before, after])]
    .map((offset) => wall - offset * 60_000)
    .filter(
      (instant) => instant + offsetMinutes(instant, timezone) * 60_000 === wall,
    );
  // RFC 5545: ambiguous hours use the first occurrence; nonexistent hours
  // use the offset before the gap, rather than oscillating between offsets.
  return candidates.length ? Math.min(...candidates) : wall - before * 60_000;
}

const PARIS_ZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Paris",
  "X-LIC-LOCATION:Europe/Paris",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19960331T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19961027T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

export function exportCalendar(events: CalendarEvent[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tempo//Calendrier local//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  if (
    events.some(
      (event) =>
        !event.allDay && (event.timezone || "Europe/Paris") === "Europe/Paris",
    )
  )
    lines.push(...PARIS_ZONE);
  for (const event of events) {
    const zone = event.timezone || "Europe/Paris";
    if (!event.allDay && !supportedZone(zone))
      throw new Error(
        `Le fuseau ${zone} n’est pas encore pris en charge à l’export. Utilisez Europe/Paris ou UTC.`,
      );
    if (
      !Number.isFinite(wallTime(event.start)) ||
      !Number.isFinite(wallTime(event.end)) ||
      event.end <= event.start
    )
      throw new Error(`Dates invalides : ${event.title}`);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(event.uid || `${event.id}@tempo.local`)}`,
      `DTSTAMP:${compactUTC(new Date())}`,
      `SUMMARY:${escapeText(event.title)}`,
    );
    if (event.allDay)
      lines.push(
        `DTSTART;VALUE=DATE:${event.start.slice(0, 10).replace(/-/g, "")}`,
        `DTEND;VALUE=DATE:${event.end.slice(0, 10).replace(/-/g, "")}`,
      );
    else if (zone === "UTC")
      lines.push(
        `DTSTART:${compact(event.start)}Z`,
        `DTEND:${compact(event.end)}Z`,
      );
    else
      lines.push(
        `DTSTART;TZID=${zone}:${compact(event.start)}`,
        `DTEND;TZID=${zone}:${compact(event.end)}`,
      );
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
    if (event.url) lines.push(`URL:${event.url.replace(/[\r\n]/g, "")}`);
    lines.push(
      `TRANSP:${event.availability === "free" ? "TRANSPARENT" : "OPAQUE"}`,
      `X-TEMPO-CATEGORY:${escapeText(event.categoryId)}`,
      `X-TEMPO-ICON:${escapeText(event.icon)}`,
    );
    if (event.recurrence.frequency !== "none") {
      let rule = `FREQ=${event.recurrence.frequency.toUpperCase()};INTERVAL=${Math.max(1, Math.floor(event.recurrence.interval || 1))}`;
      if (event.recurrence.until) {
        const date = event.recurrence.until.slice(0, 10);
        rule += event.allDay
          ? `;UNTIL=${date.replace(/-/g, "")}`
          : `;UNTIL=${compactUTC(new Date(wallToUTC(`${date}T23:59:59`, zone)))}`;
      }
      lines.push(`RRULE:${rule}`);
    }
    for (const minutes of [...new Set(event.alerts)].filter(
      (minutes) => Number.isInteger(minutes) && minutes >= 0,
    )) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeText(event.title)}`,
        `TRIGGER:${minutes ? "-" : ""}PT${minutes}M`,
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
  }
  return [...lines, "END:VCALENDAR"].map(foldLine).join("\r\n") + "\r\n";
}

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

function property(line: string): Property | null {
  // A colon inside a quoted parameter is not the value separator.
  let quoted = false;
  let colon = -1;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '"') quoted = !quoted;
    if (line[index] === ":" && !quoted) {
      colon = index;
      break;
    }
  }
  if (colon < 0) return null;
  const segments = line.slice(0, colon).split(";");
  const name = segments.shift()!.toUpperCase();
  const params: Record<string, string> = {};
  for (const segment of segments) {
    const equals = segment.indexOf("=");
    if (equals > 0)
      params[segment.slice(0, equals).toUpperCase()] = segment
        .slice(equals + 1)
        .replace(/^"|"$/g, "");
  }
  return { name, params, value: line.slice(colon + 1) };
}

function parseDate(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/.exec(
    value,
  );
  if (!match) return null;
  const result = `${match[1]}-${match[2]}-${match[3]}T${match[4] || "00"}:${match[5] || "00"}`;
  return Number.isFinite(wallTime(`${result}:${match[6] || "00"}`))
    ? result
    : null;
}

function parseDuration(value: string): number | null {
  const match =
    /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      value,
    );
  if (!match || !match.slice(2).some(Boolean)) return null;
  const minutes =
    Number(match[2] || 0) * 10080 +
    Number(match[3] || 0) * 1440 +
    Number(match[4] || 0) * 60 +
    Number(match[5] || 0) +
    Number(match[6] || 0) / 60;
  return match[1] ? -minutes : minutes;
}

function parseRule(
  value: string,
  start: string,
  zone: string,
  allDay: boolean,
): Recurrence | null {
  const rule: Record<string, string> = Object.fromEntries(
    value
      .toUpperCase()
      .split(";")
      .map((item) => item.split("=")),
  );
  if (
    Object.keys(rule).some(
      (key) => !["FREQ", "INTERVAL", "UNTIL", "WKST"].includes(key),
    )
  )
    return null;
  const frequency = rule.FREQ?.toLowerCase();
  if (!["daily", "weekly", "monthly", "yearly"].includes(frequency))
    return null;
  const interval = rule.INTERVAL ? Number(rule.INTERVAL) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 365)
    return null;
  const result: Recurrence = {
    frequency: frequency as Recurrence["frequency"],
    interval,
  };
  if (rule.UNTIL) {
    let until = parseDate(rule.UNTIL);
    if (!until) return null;
    if (!allDay && rule.UNTIL.endsWith("Z") && zone !== "UTC") {
      const instant = wallTime(until);
      until = wallString(instant + offsetMinutes(instant, zone) * 60_000);
    }
    // A date-only storage cutoff can represent the last occurrence day.
    // If a timestamp cuts off before DTSTART's clock time, use the prior day.
    if (
      !allDay &&
      rule.UNTIL.includes("T") &&
      until.slice(11, 16) < start.slice(11, 16)
    )
      until = wallString(wallTime(until.slice(0, 10)) - 86_400_000);
    result.until = until.slice(0, 10);
    if (result.until < start.slice(0, 10)) return null;
  }
  return result;
}

export function parseCalendar(text: string): {
  events: CalendarEvent[];
  warnings: string[];
} {
  if (text.length > 10_000_000)
    throw new Error("Le fichier calendrier dépasse 10 Mo.");
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n[ \t]|\n[ \t]/g, "")
    .split(/\r\n|\n|\r/);
  if (
    !lines.some((line) => line.toUpperCase() === "BEGIN:VCALENDAR") ||
    !lines.some((line) => line.toUpperCase() === "END:VCALENDAR")
  )
    throw new Error(
      "Ce fichier ne contient pas de calendrier iCalendar valide.",
    );
  const events: CalendarEvent[] = [];
  const warnings: string[] = [];
  const blocks: Property[][] = [];
  let current: Property[] | null = null;
  for (const line of lines) {
    if (line.toUpperCase() === "BEGIN:VEVENT") current = [];
    else if (line.toUpperCase() === "END:VEVENT" && current) {
      blocks.push(current);
      current = null;
    } else if (current) {
      const prop = property(line);
      if (prop) current.push(prop);
    }
  }
  if (current) warnings.push("Un événement incomplet a été ignoré.");
  if (blocks.length > 10_000)
    throw new Error("Import limité à 10 000 événements par fichier.");
  const unsupportedUIDs = new Set(
    blocks
      .filter((block) =>
        block.some((prop) =>
          ["RECURRENCE-ID", "EXDATE", "RDATE", "EXRULE"].includes(prop.name),
        ),
      )
      .map((block) => block.find((prop) => prop.name === "UID")?.value)
      .filter((uid): uid is string => Boolean(uid)),
  );
  const seen = new Set<string>();
  for (const block of blocks) {
    // Event properties are distinct from nested VALARM properties.
    const main: Property[] = [];
    const alarmBlocks: Property[][] = [];
    let alarm: Property[] | null = null;
    for (const prop of block) {
      if (prop.name === "BEGIN" && prop.value.toUpperCase() === "VALARM")
        alarm = [];
      else if (
        prop.name === "END" &&
        prop.value.toUpperCase() === "VALARM" &&
        alarm
      ) {
        alarmBlocks.push(alarm);
        alarm = null;
      } else if (alarm) alarm.push(prop);
      else main.push(prop);
    }
    const get = (name: string) => main.find((prop) => prop.name === name);
    const title =
      unescapeText(get("SUMMARY")?.value || "Événement importé").trim() ||
      "Événement importé";
    const warn = (reason: string) => warnings.push(`${title} : ${reason}`);
    const uid = unescapeText(
      get("UID")?.value || `${crypto.randomUUID()}@import.tempo.local`,
    );
    if (
      title.length > 500 ||
      uid.length > 500 ||
      !uid.trim() ||
      [title, uid].some((value) => value.includes("\0"))
    ) {
      warn("titre ou identifiant invalide ou trop long, import ignoré.");
      continue;
    }
    if (
      unsupportedUIDs.has(get("UID")?.value || "") ||
      main.some((prop) =>
        ["RECURRENCE-ID", "EXDATE", "RDATE", "EXRULE"].includes(prop.name),
      )
    ) {
      warn("série avec exceptions non prise en charge, import ignoré.");
      continue;
    }
    if (get("STATUS")?.value.toUpperCase() === "CANCELLED") {
      warn("événement annulé ignoré.");
      continue;
    }
    const startProp = get("DTSTART");
    const endProp = get("DTEND");
    if (!startProp) {
      warn("date de début manquante, import ignoré.");
      continue;
    }
    const start = parseDate(startProp.value);
    const allDay =
      startProp.params.VALUE?.toUpperCase() === "DATE" ||
      /^\d{8}$/.test(startProp.value);
    if (
      (allDay && !/^\d{8}$/.test(startProp.value)) ||
      (startProp.params.VALUE &&
        !["DATE", "DATE-TIME"].includes(startProp.params.VALUE.toUpperCase()))
    ) {
      warn("format de date de début non pris en charge, import ignoré.");
      continue;
    }
    const timezone = allDay
      ? "Europe/Paris"
      : startProp.value.endsWith("Z")
        ? "UTC"
        : startProp.params.TZID || "Europe/Paris";
    if (!allDay && !supportedZone(timezone)) {
      warn(
        `fuseau ${timezone} non pris en charge (Europe/Paris et UTC disponibles), import ignoré.`,
      );
      continue;
    }
    if (
      endProp &&
      ((!allDay &&
        (endProp.value.endsWith("Z")
          ? "UTC"
          : endProp.params.TZID || timezone) !== timezone) ||
        /^\d{8}$/.test(endProp.value) !== allDay)
    ) {
      warn("formats ou fuseaux de début et de fin différents, import ignoré.");
      continue;
    }
    let end = endProp ? parseDate(endProp.value) : null;
    if (!start || (endProp && !end)) {
      warn("date invalide, import ignoré.");
      continue;
    }
    if (!end) {
      const duration = get("DURATION")
        ? parseDuration(get("DURATION")!.value)
        : allDay
          ? 1440
          : 60;
      if (
        duration === null ||
        duration <= 0 ||
        (allDay && duration % 1440 !== 0)
      ) {
        warn("durée non prise en charge, import ignoré.");
        continue;
      }
      end = wallString(wallTime(start) + duration * 60_000);
      if (!allDay && !get("DURATION"))
        warn("durée absente ; une heure a été retenue.");
    }
    if (end <= start) {
      warn("fin antérieure ou égale au début, import ignoré.");
      continue;
    }
    if (
      [startProp, endProp].some(
        (prop) => prop && /T\d{4}(?!00)\d{2}Z?$/.test(prop.value),
      )
    )
      warn("secondes arrondies à la minute inférieure.");
    const rules = main.filter((prop) => prop.name === "RRULE");
    const recurrence = rules.length
      ? parseRule(rules[0].value, start, timezone, allDay)
      : { frequency: "none" as const, interval: 1 };
    if (rules.length > 1 || !recurrence) {
      warn("règle de répétition non prise en charge, import ignoré.");
      continue;
    }
    if (seen.has(uid)) {
      warn("UID en double dans le fichier, copie ignorée.");
      continue;
    }
    const alerts: number[] = [];
    for (const alarm of alarmBlocks) {
      const trigger = alarm.find((prop) => prop.name === "TRIGGER");
      const action = alarm
        .find((prop) => prop.name === "ACTION")
        ?.value.toUpperCase();
      const duration = trigger ? parseDuration(trigger.value) : null;
      if (
        duration !== null &&
        duration <= 0 &&
        duration >= -525600 &&
        Number.isInteger(duration) &&
        trigger?.params.RELATED !== "END" &&
        (action === "DISPLAY" || action === "AUDIO") &&
        !alarm.some((prop) => ["REPEAT", "DURATION"].includes(prop.name))
      )
        alerts.push(-duration);
      else warn("un rappel non compatible a été ignoré.");
    }
    if (!allDay && !startProp.params.TZID && !startProp.value.endsWith("Z"))
      warn("heure sans fuseau interprétée en Europe/Paris.");
    if (
      main.some((prop) =>
        ["ATTACH", "ATTENDEE", "ORGANIZER"].includes(prop.name),
      )
    )
      warn("pièces jointes et invitations externes non importées.");
    const uniqueAlerts = [...new Set(alerts)];
    if (uniqueAlerts.length > 10)
      warn("seuls les dix premiers rappels ont été conservés.");
    let url = get("URL")?.value || "";
    if (url) {
      try {
        if (
          url.length > 4000 ||
          url.includes("\0") ||
          !["https:", "http:"].includes(new URL(url).protocol)
        )
          throw new Error();
      } catch {
        url = "";
        warn("lien non compatible ignoré (HTTP ou HTTPS uniquement).");
      }
    }
    const location = unescapeText(get("LOCATION")?.value || "");
    const notes = unescapeText(get("DESCRIPTION")?.value || "");
    if (
      location.length > 2000 ||
      notes.length > 100000 ||
      [location, notes].some((value) => value.includes("\0"))
    ) {
      warn("lieu ou notes invalides ou trop longs, import ignoré.");
      continue;
    }
    let categoryId = unescapeText(get("X-TEMPO-CATEGORY")?.value || "personal");
    let icon = unescapeText(get("X-TEMPO-ICON")?.value || "📅");
    if (
      !categoryId.trim() ||
      categoryId.length > 200 ||
      categoryId.includes("\0")
    ) {
      categoryId = "personal";
      warn("catégorie invalide remplacée par Personnel.");
    }
    if (icon.length > 32 || icon.includes("\0")) {
      icon = "📅";
      warn("icône invalide remplacée.");
    }
    const now = new Date().toISOString();
    events.push({
      id: crypto.randomUUID(),
      uid,
      title,
      start,
      end,
      allDay,
      categoryId,
      icon,
      location,
      notes,
      url,
      availability:
        get("TRANSP")?.value.toUpperCase() === "TRANSPARENT" ? "free" : "busy",
      alerts: uniqueAlerts.slice(0, 10),
      recurrence,
      timezone,
      attachmentIds: [],
      createdAt: now,
      updatedAt: now,
    });
    seen.add(uid);
  }
  return { events, warnings };
}
