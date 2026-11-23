import { loadConfig } from '@job4me/config';
import { describe, expect, it } from 'vitest';
import { assertSourceSettings, availableConnectors, lockedByUsageMode } from './registry';

const settings = () => structuredClone(loadConfig({ env: { JOB4ME_ENV: 'test' } }).settings);

describe('connectors', () => {
  it('fit the default configuration, in calling order, or the demo one alone on request', () => {
    const config = settings();
    // A development .env switches the demo source on: start from the default.
    config.collect.demoSource = false;
    expect(() => assertSourceSettings(config)).not.toThrow();
    expect(availableConnectors(config).map((connector) => connector.name)).toEqual([
      'actiris',
      'forem',
      'stepstone',
      'google_jobs',
      'adzuna',
      'jobijoba',
      'jobrapido',
      'talent',
    ]);
    // Development and tests: the demo source replaces the real ones, no real site is called.
    config.collect.demoSource = true;
    expect(availableConnectors(config).map((connector) => connector.name)).toEqual(['demo']);
  });

  it('declare HTTPS host names and their usage, and switch off in commercial mode', () => {
    const config = settings();
    config.collect.demoSource = false;
    const byName = Object.fromEntries(
      availableConnectors(config).map((connector) => [connector.name, connector]),
    );
    for (const connector of Object.values(byName)) {
      for (const host of connector.hosts) expect(host).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
    }
    // Open data under CC BY-SA allows any use; the others need a licence or are no API at all.
    expect(byName.forem!.personalUseOnly).toBe(false);
    for (const name of [
      'actiris',
      'adzuna',
      'google_jobs',
      'stepstone',
      'jobijoba',
      'jobrapido',
      'talent',
    ]) {
      expect(byName[name]!.personalUseOnly).toBe(true);
    }
    // Every public page is reserved for personal use (ADR 0014).
    for (const connector of Object.values(byName)) {
      if (connector.access === 'public_page') expect(connector.personalUseOnly).toBe(true);
    }
    config.collect.usageMode = 'commercial';
    expect(lockedByUsageMode(byName.actiris!, config)).toBe(true);
    expect(lockedByUsageMode(byName.forem!, config)).toBe(false);
  });

  it('refuse to start with parameters that do not fit a connector', () => {
    const config = settings();
    config.collect.sources.actiris!.params = { pageSize: 500 };
    expect(() => assertSourceSettings(config)).toThrow(/collect\.sources\.actiris\.params/);
    const missing = settings();
    delete missing.collect.sources.forem;
    expect(() => assertSourceSettings(missing)).toThrow(/collect\.sources\.forem is missing/);
  });
});
