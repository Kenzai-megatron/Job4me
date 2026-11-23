import { describe, expect, it } from 'vitest';
import { addDays, localDate, normalizeDate } from './dates';

// Monday 23 November 2026, 10:00 in Brussels.
const context = { now: new Date('2026-11-23T09:00:00Z'), timeZone: 'Europe/Brussels' };
const date = (raw: unknown) => normalizeDate(raw, context);

describe('normalizeDate', () => {
  it('reads ISO dates, with or without a time and a zone', () => {
    expect(date('2026-11-19')).toBe('2026-11-19');
    expect(date('2026-11-19T10:00:00')).toBe('2026-11-19');
    expect(date('2026-11-19T10:00:00.123Z')).toBe('2026-11-19');
    // 23:30 UTC is already the next day in Brussels.
    expect(date('2026-11-19T23:30:00Z')).toBe('2026-11-20');
    expect(date('2026-11-19T10:00:00+01:00')).toBe('2026-11-19');
  });

  it('reads RFC 2822 dates in the Brussels calendar', () => {
    expect(date('Thu, 19 Nov 2026 10:00:00 GMT')).toBe('2026-11-19');
    expect(date('Thu, 19 Nov 2026 23:30:00 +0000')).toBe('2026-11-20');
  });

  it('reads Belgian numeric dates, day first', () => {
    expect(date('06-09-2026')).toBe('2026-09-06');
    expect(date('06/09/2026')).toBe('2026-09-06');
    expect(date('6.9.26')).toBe('2026-09-06');
    expect(date('2026/09/06')).toBe('2026-09-06');
    expect(date('31-02-2026')).toBeNull();
  });

  it('reads month names in French, Dutch and English', () => {
    expect(date('19 sep. 2026')).toBe('2026-09-19');
    expect(date('19 septembre 2026')).toBe('2026-09-19');
    expect(date('mardi 3 février 2026')).toBe('2026-02-03');
    expect(date('1er octobre 2026')).toBe('2026-10-01');
    expect(date('3 okt 2026')).toBe('2026-10-03');
    expect(date('12 maart 2026')).toBe('2026-03-12');
    expect(date('September 19, 2026')).toBe('2026-09-19');
    expect(date('Publié le 15 août 2026')).toBe('2026-08-15');
  });

  it('takes the current year, or the previous one when the day would be in the future', () => {
    expect(date('24 septembre')).toBe('2026-09-24');
    expect(date('Nov 22')).toBe('2026-11-22');
    // An ad of 28 December read in November is last year's.
    expect(date('28 décembre')).toBe('2025-12-28');
    expect(normalizeDate('28/12', { ...context, now: new Date('2027-01-03T08:00:00Z') })).toBe(
      null,
    );
    expect(normalizeDate('28 déc.', { ...context, now: new Date('2027-01-03T08:00:00Z') })).toBe(
      '2026-12-28',
    );
  });

  it('reads relative dates', () => {
    expect(date('Posted 26 days ago')).toBe('2026-10-28');
    expect(date('30+ days ago')).toBe('2026-10-24');
    expect(date('an hour ago')).toBe('2026-11-23');
    expect(date('Just posted')).toBe('2026-11-23');
    expect(date("Aujourd'hui")).toBe('2026-11-23');
    expect(date('hier')).toBe('2026-11-22');
    expect(date('il y a 3 jours')).toBe('2026-11-20');
    expect(date('Publiée il y a 2 semaines')).toBe('2026-11-09');
    expect(date('il y a plus de 30 jours')).toBe('2026-10-24');
    expect(date('il y a 30+ jours')).toBe('2026-10-24');
    expect(date('30+ dagen geleden')).toBe('2026-10-24');
    expect(date('il y a 5 h')).toBe('2026-11-23');
    expect(date('3 dagen geleden')).toBe('2026-11-20');
    expect(date('gisteren')).toBe('2026-11-22');
    expect(date('1 maand geleden')).toBe('2026-10-24');
  });

  it('reads epoch timestamps in seconds or milliseconds', () => {
    const seconds = Date.UTC(2026, 10, 19, 10) / 1000;
    expect(date(seconds)).toBe('2026-11-19');
    expect(date(seconds * 1000)).toBe('2026-11-19');
    expect(date(String(seconds))).toBe('2026-11-19');
  });

  it('returns null for what cannot be trusted', () => {
    expect(date(null)).toBeNull();
    expect(date(undefined)).toBeNull();
    expect(date('')).toBeNull();
    expect(date('bientôt')).toBeNull();
    expect(date('19 brumaire 2026')).toBeNull();
    expect(date({})).toBeNull();
    // A posting date in the future, beyond one day of margin.
    expect(date('2026-12-25')).toBeNull();
    expect(date('2026-11-24')).toBe('2026-11-24');
    expect(date('x'.repeat(200))).toBeNull();
  });
});

describe('calendar helpers', () => {
  it('give the Brussels day and move by whole days', () => {
    expect(localDate(new Date('2026-03-28T23:30:00Z'), 'Europe/Brussels')).toBe('2026-03-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
