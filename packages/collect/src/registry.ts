import type { Settings, SourceSettings } from '@job4me/config';
import type { Connector } from './connector';
import { actirisConnector } from './sources/actiris';
import { adzunaConnector } from './sources/adzuna';
import { demoConnector } from './sources/demo';
import { foremConnector } from './sources/forem';
import { googleJobsConnector } from './sources/google-jobs';
import { jobijobaConnector } from './sources/jobijoba';
import { jobrapidoConnector } from './sources/jobrapido';
import { stepstoneConnector } from './sources/stepstone';
import { talentConnector } from './sources/talent';

// Every connector, in calling order: the best informed sources first (Actiris gives the commune
// and the postal code, the Forem the languages, StepStone the employer and a teaser), so that
// phase 3 keeps the richer version of an offer seen twice (phase 2 plan, section 5); the
// aggregators last. LinkedIn arrives in lot 4.
const CONNECTORS: readonly Connector[] = [
  actirisConnector,
  foremConnector,
  stepstoneConnector,
  googleJobsConnector,
  adzunaConnector,
  jobijobaConnector,
  jobrapidoConnector,
  talentConnector,
  demoConnector,
];

/**
 * The connectors this machine offers. In development and tests (collect.demoSource) the demo
 * source replaces every real one: no real site is ever called from a development machine or
 * the CI, and no real third-party data lands there (CLAUDE.md).
 */
export function availableConnectors(settings: Settings): Connector[] {
  return settings.collect.demoSource
    ? [demoConnector]
    : CONNECTORS.filter((connector) => connector !== demoConnector);
}

export function findConnector(settings: Settings, name: string): Connector | undefined {
  return availableConnectors(settings).find((connector) => connector.name === name);
}

/** The settings of a source; every connector must have its entry in collect.sources. */
export function sourceSettings(settings: Settings, name: string): SourceSettings {
  const entry = settings.collect.sources[name];
  if (!entry) throw new Error(`collect.sources.${name} is missing from the configuration`);
  return entry;
}

/**
 * Checked at start-up by the API and the worker: a connector without settings, or with
 * parameters of the wrong shape, stops the start instead of failing at 7:10.
 */
export function assertSourceSettings(settings: Settings): void {
  // Every connector, available here or not: the same files serve the home machine.
  for (const connector of CONNECTORS) {
    const entry = sourceSettings(settings, connector.name);
    if (connector.params && !connector.params.safeParse(entry.params ?? {}).success) {
      throw new Error(`collect.sources.${connector.name}.params does not fit the connector`);
    }
  }
}

/** In commercial mode, a source reserved for personal use can neither be switched on nor run. */
export function lockedByUsageMode(connector: Connector, settings: Settings): boolean {
  return settings.collect.usageMode === 'commercial' && connector.personalUseOnly;
}
