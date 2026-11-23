import { availableConnectors, type Connector } from '@job4me/collect';
import type { Config } from '@job4me/config';
import type { CollectionPass, SourceRun } from '@job4me/contracts';
import { type Database, eq, schema, withUser } from '@job4me/db';
import { findUserByEmail } from '../modules/auth/users';
import { createPass, loadPass, plannedSources, queuePass } from '../modules/collect/passes';
import type { JobQueue } from '../context';
import { HttpError } from '../errors';
import { CliError } from './commands';

// `sources:test` and `sources:run` (phase 2 plan, section 8): the same passes as the Sources
// screen, queued for the worker, then followed until they end. The command line never calls a
// source itself.

const STATUS: Record<SourceRun['status'], string> = {
  running: 'en cours',
  succeeded: 'réussie',
  partial: 'partielle',
  failed: 'en échec',
  skipped: 'sautée',
};

const SKIP: Record<NonNullable<SourceRun['skipReason']>, string> = {
  disabled: 'interrupteur coupé',
  commercial_mode: 'mode commercial',
  cooldown: 'attente après un 403 ou un 429',
  missing_key: 'clé absente',
  no_keywords: 'aucun mot-clé validé',
  quota: 'quota épuisé',
  pass_budget: 'budget du passage épuisé',
};

const ERROR: Record<NonNullable<SourceRun['errorCode']>, string> = {
  blocked: 'refusée par le site',
  http_error: 'erreur HTTP',
  network_error: 'réseau injoignable',
  timeout: 'délai dépassé',
  too_large: 'réponse trop grande',
  invalid_response: 'réponse inattendue',
  host_not_allowed: 'hôte non autorisé',
  budget_exceeded: 'budget de temps épuisé',
  connector_error: 'erreur du connecteur',
  interrupted: 'interrompue',
};

/** One line per source: status, read, kept, new, duration and why. */
export function formatPass(pass: CollectionPass): string {
  const header = ['Source', 'Statut', 'Lues', 'Retenues', 'Inédites', 'Durée', 'Détail'];
  const rows = pass.runs.map((run) => {
    const skipped = run.status === 'skipped';
    const detail = run.skipReason
      ? SKIP[run.skipReason]
      : run.errorCode
        ? `${ERROR[run.errorCode]}${run.httpStatus ? ` (HTTP ${run.httpStatus})` : ''}`
        : '';
    return [
      run.source,
      STATUS[run.status],
      skipped ? '-' : String(run.readCount),
      skipped ? '-' : String(run.keptCount),
      skipped ? '-' : String(run.newCount),
      run.durationMs === null || skipped
        ? '-'
        : `${(run.durationMs / 1000).toFixed(1).replace('.', ',')} s`,
      detail,
    ];
  });
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]!.length)),
  );
  return [header, ...rows]
    .map((row) =>
      row
        .map((cell, column) =>
          column >= 2 && column <= 5
            ? cell.padStart(widths[column]!)
            : cell.padEnd(widths[column]!),
        )
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

/** The account named by --email, or the only active one. */
async function accountOf(db: Database, email: string | undefined): Promise<string> {
  if (email) {
    const user = await findUserByEmail(db, email);
    if (!user) throw new CliError('Aucun compte pour cette adresse.');
    return user.id;
  }
  const active = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.status, 'active'))
    .limit(2);
  if (active.length !== 1) throw new CliError('Plusieurs comptes ou aucun : précise --email.');
  return active[0]!.id;
}

export interface SourcesPassOptions {
  trigger: 'test' | 'manual';
  email?: string;
  sources?: string[];
  queue: JobQueue;
  /** Tests replace the connectors of this machine. */
  connectors?: readonly Connector[];
  /** How often the pass is read again while waiting, and when to stop waiting. */
  pollMs?: number;
  timeoutMs?: number;
  print?: (line: string) => void;
}

export async function sourcesPass(
  db: Database,
  config: Config,
  options: SourcesPassOptions,
): Promise<CollectionPass> {
  const print = options.print ?? ((line: string) => console.log(line));
  const { settings } = config;
  const userId = await accountOf(db, options.email);
  const connectors = options.connectors ?? availableConnectors(settings);
  let sources: string[];
  try {
    sources = plannedSources(connectors, options.sources);
  } catch (error) {
    if (error instanceof HttpError) {
      const known = plannedSources(connectors).join(', ') || 'aucune';
      throw new CliError(`Source inconnue. Sources de cette machine : ${known}.`);
    }
    throw error;
  }
  if (sources.length === 0) throw new CliError('Aucune source sur cette machine.');
  const { pass, created } = await withUser(db, userId, (tx) =>
    createPass(tx, settings, { userId, trigger: options.trigger, sources, actor: 'cli' }),
  );
  if (created) await queuePass(options.queue, userId, pass.id);
  print(
    `${options.trigger === 'test' ? 'Test des sources' : 'Passage'} ${created ? 'lancé' : 'déjà en cours'} : ${sources.join(', ')}. En attente du worker…`,
  );

  const deadline = Date.now() + (options.timeoutMs ?? settings.collect.passBudgetMs + 60_000);
  const pollMs = options.pollMs ?? 2000;
  for (;;) {
    const current = await withUser(db, userId, (tx) => loadPass(tx, userId, pass.id));
    if (current && (current.status === 'done' || current.status === 'interrupted')) {
      print(formatPass(current));
      if (current.status === 'interrupted') print('Passage interrompu (worker arrêté ?).');
      return current;
    }
    if (Date.now() > deadline) {
      throw new CliError(
        'Le worker n’a pas terminé à temps. Vérifie qu’il tourne (pnpm stack:logs), puis relance.',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
