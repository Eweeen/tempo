import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../src/types';
import { addDays, buildWorkEvents, dateKey, frenchHolidays, getOccurrences, monthCells, monthDays, startOfWeek } from '../src/lib/calendar';

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: 'test', uid: 'test@tempo.local', title: 'Travail', start: '2026-03-27T05:00', end: '2026-03-27T13:00', allDay: false, categoryId: 'work', icon: '💼', location: '', notes: '', url: '', availability: 'busy', alerts: [15], recurrence: { frequency: 'none', interval: 1 }, timezone: 'Europe/Paris', attachmentIds: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...overrides };
}

describe('calendar navigation', () => {
  it('shows only the dates of the month, with blank cells for weekday alignment', () => {
    const cells = monthCells(new Date(2026, 10, 9));
    const days = cells.filter((day): day is Date => day !== null);
    expect(days).toHaveLength(30);
    expect(cells.slice(0, 6)).toEqual(Array(6).fill(null));
    expect(dateKey(days[0])).toBe('2026-11-01');
    expect(dateKey(days.at(-1)!)).toBe('2026-11-30');
    expect(days.every(day => day.getMonth() === 10)).toBe(true);
  });

  it('adapts the number of rows for a four-week February and includes leap day', () => {
    const february = monthCells(new Date(2027, 1, 1));
    expect(february).toHaveLength(28);
    expect(february.every(Boolean)).toBe(true);
    const leap = monthCells(new Date(2028, 1, 1)).filter((day): day is Date => day !== null);
    expect(leap).toHaveLength(29);
    expect(dateKey(leap.at(-1)!)).toBe('2028-02-29');
  });

  it('uses Monday-first six-week grids including adjacent months', () => {
    const days = monthDays(new Date(2026, 10, 15));
    expect(days).toHaveLength(42);
    expect(dateKey(days[0])).toBe('2026-10-26');
    expect(days[0].getDay()).toBe(1);
    expect(dateKey(days[41])).toBe('2026-12-06');
    expect(dateKey(startOfWeek(new Date(2026, 10, 15)))).toBe('2026-11-09');
  });

  it('adds calendar days without mutating the source', () => {
    const source = new Date(2026, 2, 28, 12);
    expect(dateKey(addDays(source, 2))).toBe('2026-03-30');
    expect(source.getDate()).toBe(28);
    expect(addDays(source, 2).getHours()).toBe(12);
  });
});

describe('work creation', () => {
  const options = { week: '2026-11-11', days: [1, 2, 3, 4, 5], startTime: '05:00', endTime: '13:00', title: 'Équipe du matin', categoryId: 'work', icon: '💼', alerts: [30], timezone: 'Europe/Paris' };

  it('creates five independent events anchored to Monday', () => {
    const events = buildWorkEvents(options);
    expect(events).toHaveLength(5);
    expect(events[0].start).toBe('2026-11-09T05:00');
    expect(events[4].end).toBe('2026-11-13T13:00');
    expect(new Set(events.map(item => item.id)).size).toBe(5);
    expect(new Set(events.map(item => item.batchId)).size).toBe(1);
    expect(events.every(item => item.recurrence.frequency === 'none')).toBe(true);
  });

  it('handles overnight shifts and deduplicates days', () => {
    const events = buildWorkEvents({ ...options, days: [1, 1, 7], startTime: '21:00', endTime: '05:00' });
    expect(events).toHaveLength(2);
    expect(events[0].end).toBe('2026-11-10T05:00');
    expect(events[1].end).toBe('2026-11-16T05:00');
  });

  it('rejects impossible dates and ambiguous zero-duration shifts', () => {
    expect(() => buildWorkEvents({ ...options, week: '2026-02-30' })).toThrow();
    expect(() => buildWorkEvents({ ...options, startTime: '25:00' })).toThrow();
    expect(() => buildWorkEvents({ ...options, endTime: '05:00' })).toThrow();
  });
});

describe('occurrences', () => {
  it('preserves civil hours over the spring DST change', () => {
    const result = getOccurrences([event({ recurrence: { frequency: 'daily', interval: 1, until: '2026-03-30' } })], new Date(2026, 2, 27), new Date(2026, 3, 1));
    expect(result.map(item => item.start)).toEqual(['2026-03-27T05:00', '2026-03-28T05:00', '2026-03-29T05:00', '2026-03-30T05:00']);
    expect(result.every(item => item.end.endsWith('T13:00'))).toBe(true);
  });

  it('includes overnight overlaps but excludes events ending at the range start', () => {
    const result = getOccurrences([event({ start: '2026-11-08T21:00', end: '2026-11-09T05:00' }), event({ id: 'ended', start: '2026-11-08T12:00', end: '2026-11-09T00:00' })], new Date(2026, 10, 9), new Date(2026, 10, 10));
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe('2026-11-08T21:00');
  });

  it('skips nonexistent monthly dates without drifting', () => {
    const result = getOccurrences([event({ start: '2026-01-31T05:00', end: '2026-01-31T13:00', recurrence: { frequency: 'monthly', interval: 1 } })], new Date(2026, 0, 1), new Date(2026, 5, 1));
    expect(result.map(item => item.start.slice(0, 10))).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });

  it('skips non-leap years for 29 February', () => {
    const result = getOccurrences([event({ start: '2024-02-29T05:00', end: '2024-02-29T13:00', recurrence: { frequency: 'yearly', interval: 1 } })], new Date(2025, 0, 1), new Date(2029, 0, 1));
    expect(result.map(item => item.start)).toEqual(['2028-02-29T05:00']);
  });

  it('jumps efficiently to a distant range for longstanding daily series', () => {
    const result = getOccurrences([event({ start: '1950-01-01T05:00', end: '1950-01-01T13:00', recurrence: { frequency: 'daily', interval: 2 } })], new Date(2026, 10, 9), new Date(2026, 10, 16));
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.length).toBeLessThanOrEqual(4);
  });
});

describe('French holidays', () => {
  it('computes movable and fixed holidays for 2026', () => {
    const holidays = frenchHolidays(2026, 'fr');
    expect(holidays).toHaveLength(11);
    expect(holidays.find(item => item.name === 'Lundi de Pâques')?.date).toBe('2026-04-06');
    expect(holidays.find(item => item.name === 'Ascension')?.date).toBe('2026-05-14');
    expect(holidays.find(item => item.name === 'Lundi de Pentecôte')?.date).toBe('2026-05-25');
    expect(holidays.some(item => item.date === '2026-11-11')).toBe(true);
  });

  it('includes regional holidays while qualifying Good Friday', () => {
    const holidays = frenchHolidays(2026, 'alsace');
    expect(holidays).toHaveLength(13);
    expect(holidays.find(item => item.date === '2026-04-03')?.name).toContain('selon la commune');
    expect(holidays.some(item => item.date === '2026-12-26')).toBe(true);
  });
});
