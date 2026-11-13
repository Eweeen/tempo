import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../src/types';
import { exportCalendar, foldLine, parseCalendar, wallToUTC } from '../src/lib/ics';

const fixture = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({ id: 'sample', uid: 'sample@tempo.local', title: 'Concert, Paris ; 🎵', start: '2026-11-09T20:00', end: '2026-11-09T23:00', allDay: false, categoryId: 'concert', icon: '🎵', location: 'Paris, France', notes: 'Billets\\réservation\nDeux places', url: 'https://example.com/tickets', availability: 'busy', alerts: [0, 15, 1440], recurrence: { frequency: 'none', interval: 1 }, timezone: 'Europe/Paris', attachmentIds: ['local-file'], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...overrides });
const wrap = (lines: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${lines}\r\nEND:VCALENDAR\r\n`;
const simple = (extra = '') => `BEGIN:VEVENT\r\nUID:source@example.com\r\nDTSTART;TZID=Europe/Paris:20261109T050000\r\nDTEND;TZID=Europe/Paris:20261109T130000\r\nSUMMARY:Travail\r\n${extra}\r\nEND:VEVENT`;

describe('iCalendar export and import', () => {
  it('resolves ambiguous and nonexistent Paris times according to RFC 5545', () => {
    expect(new Date(wallToUTC('2026-10-25T02:30', 'Europe/Paris')).toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(new Date(wallToUTC('2026-03-29T02:30', 'Europe/Paris')).toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(new Date(wallToUTC('2026-11-09T05:00', 'Europe/Paris')).toISOString()).toBe('2026-11-09T04:00:00.000Z');
  });
  it('round trips text escapes, UID, alarm minutes and event parameters', () => {
    const original = fixture();
    const exported = exportCalendar([original]);
    expect(exported).toContain('BEGIN:VTIMEZONE\r\nTZID:Europe/Paris');
    const { events, warnings } = parseCalendar(exported);
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(1);
    for (const field of ['uid', 'title', 'start', 'end', 'allDay', 'categoryId', 'icon', 'location', 'notes', 'url', 'availability', 'alerts', 'recurrence', 'timezone'] as const) expect(events[0][field]).toEqual(original[field]);
    expect(events[0].attachmentIds).toEqual([]);
  });

  it('uses an exclusive end date for all-day events', () => {
    const original = fixture({ allDay: true, start: '2026-11-09T00:00', end: '2026-11-10T00:00' });
    const exported = exportCalendar([original]);
    expect(exported).toContain('DTSTART;VALUE=DATE:20261109\r\nDTEND;VALUE=DATE:20261110');
    const parsed = parseCalendar(exported).events[0];
    expect(parsed.start).toBe(original.start);
    expect(parsed.end).toBe(original.end);
    expect(parsed.allDay).toBe(true);
  });

  it('folds Unicode by octets without damaging emoji', () => {
    const title = '🎵é東京'.repeat(40);
    const folded = foldLine(`SUMMARY:${title}`);
    expect(folded.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(parseCalendar(exportCalendar([fixture({ title })])).events[0].title).toBe(title);
  });

  it('preserves weekly recurrence and inclusive cutoff through DST', () => {
    const original = fixture({ start: '2026-03-23T05:00', end: '2026-03-23T13:00', recurrence: { frequency: 'weekly', interval: 2, until: '2026-04-30' } });
    const exported = exportCalendar([original]);
    expect(exported).toContain('UNTIL=20260430T215959Z');
    expect(parseCalendar(exported).events[0].recurrence).toEqual(original.recurrence);
  });

  it('preserves UTC events without adding Paris time', () => {
    const original = fixture({ timezone: 'UTC' });
    const exported = exportCalendar([original]);
    expect(exported).toContain('DTSTART:20261109T200000Z');
    expect(exported).not.toContain('VTIMEZONE');
    expect(parseCalendar(exported).events[0].timezone).toBe('UTC');
  });

  it('does not allow newline property injection through text or URL fields', () => {
    const exported = exportCalendar([fixture({ title: 'title\r\nATTENDEE:attacker', url: 'https://example.com\r\nATTACH:evil' })]);
    expect(exported).not.toContain('\r\nATTENDEE:');
    expect(exported).not.toContain('\r\nATTACH:');
  });

  it('rejects unsupported recurrence instead of silently flattening it', () => {
    const result = parseCalendar(wrap(simple('RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10')));
    expect(result.events).toEqual([]);
    expect(result.warnings[0]).toContain('répétition');
  });

  it('rejects an entire recurrence series when exceptions are present', () => {
    const exception = 'BEGIN:VEVENT\r\nUID:source@example.com\r\nRECURRENCE-ID:20261116T050000\r\nDTSTART:20261116T060000\r\nDTEND:20261116T140000\r\nEND:VEVENT';
    const result = parseCalendar(wrap(simple('RRULE:FREQ=WEEKLY') + '\r\n' + exception));
    expect(result.events).toEqual([]);
    expect(result.warnings).toHaveLength(2);
  });

  it('deduplicates repeated UIDs in the same import', () => {
    const result = parseCalendar(wrap(simple() + '\r\n' + simple()));
    expect(result.events).toHaveLength(1);
    expect(result.warnings[0]).toContain('double');
  });

  it('reports unsupported timezones and alarm forms', () => {
    expect(parseCalendar(wrap(simple().replaceAll('Europe/Paris', 'America/New_York'))).events).toEqual([]);
    const result = parseCalendar(wrap(simple('BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER;VALUE=DATE-TIME:20261109T040000Z\r\nEND:VALARM')));
    expect(result.events[0].alerts).toEqual([]);
    expect(result.warnings[0]).toContain('rappel');
  });

  it('handles duration and quoted TZID parameters', () => {
    const result = parseCalendar(wrap('BEGIN:VEVENT\r\nDTSTART;TZID="Europe/Paris":20261109T050000\r\nDURATION:PT8H\r\nEND:VEVENT'));
    expect(result.events[0].end).toBe('2026-11-09T13:00');
  });

  it('defaults a DATE event without DTEND to one day', () => {
    const result = parseCalendar(wrap('BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261225\r\nEND:VEVENT'));
    expect(result.events[0].end).toBe('2026-12-26T00:00');
  });

  it('rejects malformed calendars and impossible dates', () => {
    expect(() => parseCalendar('not a calendar')).toThrow();
    expect(parseCalendar(wrap(simple().replaceAll('20261109', '20260230'))).events).toEqual([]);
    expect(parseCalendar(wrap(simple().replace('T050000', 'T050099'))).events).toEqual([]);
    expect(parseCalendar(wrap(simple().replace('DTSTART;TZID=Europe/Paris:', 'DTSTART;VALUE=DATE:'))).events).toEqual([]);
  });

  it('drops incompatible links while preserving a valid event', () => {
    const result = parseCalendar(wrap(simple('URL:javascript:alert(1)')));
    expect(result.events[0].url).toBe('');
    expect(result.warnings[0]).toContain('lien');
  });

  it('aligns imported recurrence and text limits with persistent storage', () => {
    expect(parseCalendar(wrap(simple('RRULE:FREQ=DAILY;INTERVAL=366'))).events).toEqual([]);
    expect(parseCalendar(wrap(simple().replace('SUMMARY:Travail', `SUMMARY:${'a'.repeat(501)}`))).events).toEqual([]);
    expect(parseCalendar(wrap(simple('RRULE:FREQ=DAILY;UNTIL=20260101T000000Z'))).events).toEqual([]);
  });

  it('limits alarms to ten unique compatible values', () => {
    const alarms = Array.from({ length: 11 }, (_, index) => `BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT${index + 1}M\r\nEND:VALARM`).join('\r\n');
    const result = parseCalendar(wrap(simple(alarms)));
    expect(result.events[0].alerts).toHaveLength(10);
    expect(result.warnings).toContain('Travail : seuls les dix premiers rappels ont été conservés.');
  });
});
