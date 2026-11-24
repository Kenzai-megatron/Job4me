import type { Config } from '@job4me/config';
import {
  type Benchmark,
  type BenchmarkErrorCode,
  type BenchmarkGap,
  QUEUES,
} from '@job4me/contracts';
import { count, type Database, eq, schema, withUser } from '@job4me/db';
import type { JobQueue } from '../context';
import { toBenchmark } from '../modules/ai/benchmarks';
import { CliError } from './commands';
import { accountOf } from './sources';

// `scoring:benchmark` and `scoring:run` (phase 3 plan, section 9): from the home machine, the
// measure of the reference set and the scoring by Claude on demand. The worker does the work;
// the command line queues it and, for the measure, follows it until it ends.

const ERRORS: Record<BenchmarkErrorCode, string> = {
  ai_disabled: 'IA non configurée sur cette machine (clé absente)',
  ai_cap_reached: 'plafond de dépense atteint',
  ai_refused: 'refusée par le modèle',
  ai_invalid_output: 'réponse inexploitable',
  ai_failed: 'API Claude injoignable',
  no_rating: 'aucune offre notée',
};

const points = (value: number) => value.toFixed(1).replace('.', ',');
const dollars = (value: number) =>
  `${value.toFixed(value > 0 && value < 0.01 ? 4 : 2).replace('.', ',')} $`;

/** The measure as Mehdi reads it in the terminal. */
export function formatBenchmark(benchmark: Benchmark, config: Config): string {
  const { reference } = config.settings.scoring;
  const verdict = (gap: number) =>
    gap <= reference.maxMeanGap
      ? `sous le seuil de ${reference.maxMeanGap}`
      : `au-dessus du seuil de ${reference.maxMeanGap}`;
  const lines = [`Offres notées : ${benchmark.rated} (objectif : ${reference.goal})`];
  const worst = (list: readonly BenchmarkGap[]) =>
    list.map(
      (gap) =>
        `    ${gap.title} : ta note ${gap.rating}, score ${gap.score} (écart ${Math.abs(gap.rating - gap.score)})`,
    );
  if (benchmark.rules) {
    lines.push(
      `Notation sans IA (${benchmark.rules.version}) : écart moyen ${points(benchmark.rules.meanGap)} points, ${verdict(benchmark.rules.meanGap)}`,
    );
    if (benchmark.rules.worst.length > 0) {
      lines.push('  Plus grands écarts :', ...worst(benchmark.rules.worst));
    }
  }
  if (benchmark.claude) {
    const claude = benchmark.claude;
    lines.push(
      `Notation par Claude (${claude.quickModel}, puis ${claude.detailedModel} à partir de ${config.settings.ai.scoring.detailed.threshold} ; ${claude.promptVersion}) sur ${claude.rated} offres hors étalon : écart moyen ${points(claude.meanGap)} points, ${verdict(claude.meanGap)}`,
      `  Coût : ${dollars(claude.costUsd)}, soit ${dollars(claude.costPerOfferUsd)} par offre`,
    );
    if (claude.worst.length > 0) lines.push('  Plus grands écarts :', ...worst(claude.worst));
  }
  if (benchmark.titleFilter) {
    const { rated, rejected } = benchmark.titleFilter;
    const share = rated > 0 ? rejected / rated : 0;
    lines.push(
      `Pré-filtre de titre : ${rejected} sur ${rated} offres notées ${reference.filterRating} ou plus auraient été écartées (${Math.round(share * 100)} %, au plus ${Math.round(reference.maxFilterRejected * 100)} %)${share > reference.maxFilterRejected ? ' : à revoir' : ''}`,
    );
  }
  if (benchmark.status === 'failed') {
    lines.push(
      `Mesure en échec : ${benchmark.errorCode ? ERRORS[benchmark.errorCode] : 'erreur inconnue'}`,
    );
  }
  return lines.join('\n');
}

export interface BenchmarkOptions {
  email?: string;
  /** Measure Claude too: a few cents, under the caps. */
  claude: boolean;
  queue: JobQueue;
  pollMs?: number;
  timeoutMs?: number;
  print?: (line: string) => void;
}

export async function scoringBenchmark(
  db: Database,
  config: Config,
  options: BenchmarkOptions,
): Promise<Benchmark> {
  const print = options.print ?? ((line: string) => console.log(line));
  const userId = await accountOf(db, options.email);
  const benchmarks = schema.scoringBenchmarks;
  const created = await withUser(db, userId, async (tx) => {
    const [rated] = await tx
      .select({ n: count() })
      .from(schema.offerRatings)
      .where(eq(schema.offerRatings.userId, userId));
    if ((rated?.n ?? 0) === 0) return null;
    const [row] = await tx
      .insert(benchmarks)
      .values({ userId, withClaude: options.claude })
      .returning({ id: benchmarks.id });
    return { id: row!.id, rated: rated!.n };
  });
  if (!created) {
    throw new CliError(
      'Aucune offre notée : note des offres dans Job4me (« Ma note » sur la fiche d’une offre).',
    );
  }
  await options.queue.send(QUEUES.scoringBenchmark, { userId, benchmarkId: created.id });
  print(
    `Mesure lancée sur ${created.rated} offre(s) notée(s)${options.claude ? ', Claude compris' : ''}. En attente du worker…`,
  );
  const deadline = Date.now() + (options.timeoutMs ?? config.settings.scoring.reference.timeoutMs);
  const pollMs = options.pollMs ?? 2000;
  for (;;) {
    const [row] = await withUser(db, userId, (tx) =>
      tx.select().from(benchmarks).where(eq(benchmarks.id, created.id)),
    );
    if (row && (row.status === 'done' || row.status === 'failed')) {
      const benchmark = toBenchmark(row);
      print(formatBenchmark(benchmark, config));
      return benchmark;
    }
    if (Date.now() > deadline) {
      throw new CliError(
        'Le worker n’a pas terminé à temps. Vérifie qu’il tourne (pnpm stack:logs), puis relance.',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** The scoring by Claude now, rather than after the next pass. */
export async function scoringRun(
  db: Database,
  config: Config,
  options: { email?: string; queue: JobQueue; print?: (line: string) => void },
): Promise<void> {
  const print = options.print ?? ((line: string) => console.log(line));
  if (!config.settings.ai.scoring.enabled) {
    throw new CliError(
      'La notation par Claude est coupée : ajoute JOB4ME_AI_SCORING=true à .env, puis pnpm stack:up.',
    );
  }
  const userId = await accountOf(db, options.email);
  await options.queue.send(QUEUES.offersAiScore, { userId });
  print(
    'Notation par Claude demandée : les scores apparaîtront dans Offres d’ici quelques minutes.',
  );
}
