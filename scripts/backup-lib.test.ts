import { describe, expect, it } from 'vitest';
import { parseCounts, stampOf, toKeep, weekOf } from './backup-lib';

describe('backup retention (ADR 0012)', () => {
  it('names backups after their UTC time', () => {
    expect(stampOf(new Date('2026-11-23T06:49:17Z'))).toBe('20261123-064917');
  });

  it('groups backups by Monday-based week', () => {
    expect(weekOf('20261123-030000')).toBe('2026-11-23'); // a Monday
    expect(weekOf('20261129-030000')).toBe('2026-11-23'); // the Sunday after
    expect(weekOf('20261122-030000')).toBe('2026-11-16');
  });

  it('keeps the newest backups, then one a week, and drops the rest', () => {
    // 40 nightly backups, from 2026-10-15 to 2026-11-23.
    const stamps = Array.from({ length: 40 }, (_, day) =>
      stampOf(new Date(Date.UTC(2026, 9, 15 + day, 3, 0, 0))),
    );
    const keep = toKeep(stamps, 14, 3);
    expect(keep.size).toBe(17);
    for (const stamp of stamps.slice(-14)) expect(keep.has(stamp)).toBe(true);
    // The weekly ones are the newest of their week, older than the daily ones.
    const weekly = [...keep].filter((stamp) => !stamps.slice(-14).includes(stamp)).sort();
    expect(new Set(weekly.map(weekOf)).size).toBe(3);
    expect(keep.has(stamps[0]!)).toBe(false);
  });

  it('reads the row counts printed by psql', () => {
    expect(parseCounts('skill=3\nuser=1\n\nnoise\n')).toEqual({ skill: 3, user: 1 });
  });
});
