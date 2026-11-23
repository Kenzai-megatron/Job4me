import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { CollectError, PoliteClient } from '@job4me/collect';
import { loadConfig } from '@job4me/config';
import { ROOT } from './lib';
import { linkedinFigures, overlap, type PageFigures } from './probe-linkedin-lib';

// `pnpm probe:linkedin [--keyword <mot-clé>]` (phase 2 plan, decision D1): run once, from the
// home connection only, before the LinkedIn connector is written. Two calls to the guest search
// (start=0, then start=10, the pause of the configuration apart), one attempt each, a stop at the
// first 403 or 429. It prints figures only, to send back as they are. After a 429, nothing may
// call LinkedIn for 24 hours.

const ENDPOINT = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

interface Call {
  start: number;
  status: number | null;
  ms: number;
  error: string | null;
  figures: Omit<PageFigures, 'ids'> | null;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { keyword: { type: 'string', default: 'comptable' } } });
  const { settings } = loadConfig({
    env: { ...process.env, JOB4ME_ENV: 'test', JOB4ME_CONFIG_DIR: join(ROOT, 'config') },
  });
  const source = settings.collect.sources.linkedin;
  if (!source) throw new Error('collect.sources.linkedin is missing from the configuration');
  const location = String(source.params?.location ?? 'Brussels, Belgium');
  const client = new PoliteClient({
    source: 'linkedin',
    hosts: ['www.linkedin.com'],
    pauseMs: source.pauseMs,
    retries: 0,
    http: settings.collect.http,
    signal: AbortSignal.timeout(source.pauseMs + 4 * settings.collect.http.timeoutMs),
  });
  const calls: Call[] = [];
  const ids: string[][] = [];
  console.log(`Deux appels, ${source.pauseMs / 1000} s d'écart. Patiente…`);
  for (const start of [0, 10]) {
    const query = [
      `keywords=${encodeURIComponent(values.keyword)}`,
      `location=${encodeURIComponent(location)}`,
      `start=${start}`,
      'f_TPR=r604800',
    ].join('&');
    const began = Date.now();
    try {
      const response = await client.getText(`${ENDPOINT}?${query}`);
      const { ids: pageIds, ...figures } = linkedinFigures(response.text);
      ids.push(pageIds);
      calls.push({ start, status: response.status, ms: Date.now() - began, error: null, figures });
    } catch (error) {
      const failure = error instanceof CollectError ? error : new CollectError('network_error');
      calls.push({
        start,
        status: failure.httpStatus,
        ms: Date.now() - began,
        error: failure.code,
        figures: null,
      });
      // A refusal ends the probe: never a second try.
      break;
    }
  }
  const report = {
    probe: 'linkedin-guest',
    at: new Date().toISOString(),
    keyword: values.keyword,
    location,
    calls,
    overlap: ids.length === 2 ? overlap(ids[0]!, ids[1]!) : null,
  };
  console.log('\n--- À renvoyer à Claude, tel quel ---');
  console.log(JSON.stringify(report, null, 2));
  console.log('--- Fin ---');
  if (calls.some((call) => call.status === 429 || call.status === 403)) {
    console.log("\nLinkedIn a refusé : n'appelle plus LinkedIn pendant 24 heures.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
