import type { Settings, SourceSettings } from '@job4me/config';
import type { Connector } from './connector';
import { demoConnector } from './sources/demo';

// Every connector, in calling order: the best informed sources first, so that phase 3 keeps
// the richer version of an offer seen twice (phase 2 plan, section 5). The real sources arrive
// in lots 2 to 4.
const CONNECTORS: readonly Connector[] = [demoConnector];

/** The connectors this machine offers: the demo one only when the configuration asks for it. */
export function availableConnectors(settings: Settings): Connector[] {
  return CONNECTORS.filter((connector) => connector.name !== 'demo' || settings.collect.demoSource);
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

/** Checked at start-up by the API and the worker: a connector without settings never runs. */
export function assertSourceSettings(settings: Settings): void {
  for (const connector of availableConnectors(settings)) sourceSettings(settings, connector.name);
}

/** In commercial mode, a source reserved for personal use can neither be switched on nor run. */
export function lockedByUsageMode(connector: Connector, settings: Settings): boolean {
  return settings.collect.usageMode === 'commercial' && connector.personalUseOnly;
}
