import { parseArgs } from 'node:util';
import { type Config, loadConfig, loadSecrets } from '@job4me/config';
import { connect, queueOptions } from '@job4me/db';
import { PgBoss } from 'pg-boss';
import { parseMasterKey } from '@job4me/security';
import { PasswordTooWeakError } from '../modules/auth/users';
import { auditTail, CliError, sessionsRevokeAll, userCreate, userEnrollLink } from './commands';
import { sendTestMail } from './mail';
import { sourcesPass } from './sources';

// `pnpm job4me <command>`: administration from the machine itself, the root of trust (ADR 0003).

const HELP = `Utilisation : pnpm job4me <commande> [options]

  user:create --email <adresse> --name <nom>   crée le compte et affiche le lien d'enrôlement
  user:enroll-link --email <adresse>           nouveau lien d'enrôlement (anciens liens annulés)
  sessions:revoke-all --email <adresse>        déconnecte toutes les sessions
  audit:tail [--limit 20]                      derniers événements du journal d'audit
  config:check                                 vérifie la configuration et les secrets
  mail:test --to <adresse>                     envoie un mail de test (Mailpit en développement)
  sources:test [--source <nom>]… [--email …]   teste les sources : un mot-clé, une page chacune
  sources:run [--source <nom>]… [--email …]    lance un passage de collecte complet

Le mot de passe est demandé sans écho ; hors terminal, il est lu sur l'entrée standard.`;

const PASSWORD_PROBLEMS: Record<string, string> = {
  too_short: 'trop court',
  too_long: 'trop long',
  too_common: 'trop courant',
  too_repetitive: 'trop répétitif',
};

function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          cleanup();
          reject(new CliError('Annulé.'));
          return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin) input += String(chunk);
    return input.split(/\r?\n/)[0] ?? '';
  }
  const first = await promptHidden('Mot de passe de secours : ');
  const second = await promptHidden('Le même, une seconde fois : ');
  if (first !== second) throw new CliError('Les deux saisies diffèrent.');
  return first;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new CliError(`Option manquante : --${name}`);
  return value;
}

function printLink(link: string, expiresAt: Date, config: Config) {
  console.log(`\nLien d'enrôlement, à usage unique :\n\n  ${link}\n`);
  console.log(
    `Valable jusqu'à ${expiresAt.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels' })} ` +
      `(${config.settings.auth.enrollmentLinkMinutes} minutes). Ouvre-le dans le navigateur qui gardera la passkey.`,
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      to: { type: 'string' },
      limit: { type: 'string', default: '20' },
      source: { type: 'string', multiple: true },
    },
    allowPositionals: false,
  });

  if (!command || command === 'help' || command === '--help') {
    console.log(HELP);
    return;
  }

  const config = loadConfig();
  const secrets = loadSecrets();

  if (command === 'config:check') {
    parseMasterKey(secrets.masterKey);
    console.log(`Environnement : ${config.env}`);
    console.log(`Adresse publique : ${config.settings.app.publicOrigin}`);
    console.log(`RP ID (passkeys) : ${config.settings.app.rpId}`);
    console.log(`Clé maîtresse : présente et valide`);
    console.log(
      `Clés VAPID (notifications) : ${secrets.vapidPublicKey && secrets.vapidPrivateKey ? 'présentes' : 'absentes'}`,
    );
    console.log('Configuration valide.');
    return;
  }

  if (command === 'mail:test') {
    const to = required(values.to, 'to');
    await sendTestMail(config, to);
    console.log(`Mail de test envoyé à ${to}. En développement : http://127.0.0.1:8025 (Mailpit).`);
    return;
  }

  const database = connect(secrets.databaseUrl, { max: 2, applicationName: 'job4me-cli' });
  try {
    switch (command) {
      case 'user:create': {
        const email = required(values.email, 'email');
        const name = required(values.name, 'name');
        const password = await readPassword();
        const result = await userCreate(database.db, config, { email, name, password });
        console.log('Compte créé.');
        printLink(result.link, result.expiresAt, config);
        break;
      }
      case 'user:enroll-link': {
        const result = await userEnrollLink(database.db, config, {
          email: required(values.email, 'email'),
        });
        printLink(result.link, result.expiresAt, config);
        break;
      }
      case 'sessions:revoke-all': {
        const count = await sessionsRevokeAll(database.db, {
          email: required(values.email, 'email'),
        });
        console.log(`${count} session(s) fermée(s).`);
        break;
      }
      case 'audit:tail': {
        const limit = Math.min(Math.max(Number(values.limit) || 20, 1), 500);
        const rows = await auditTail(database.db, limit);
        for (const row of rows.reverse()) {
          console.log(
            `${row.occurredAt.toISOString()}  ${row.outcome.padEnd(7)}  ${row.actorType.padEnd(6)}  ${row.action}  ${JSON.stringify(row.metadata)}`,
          );
        }
        break;
      }
      case 'sources:test':
      case 'sources:run': {
        // The worker runs the pass; the command line only queues it and follows it.
        const boss = new PgBoss({
          ...queueOptions(secrets.databaseUrl),
          supervise: false,
          schedule: false,
          max: 1,
        });
        await boss.start();
        try {
          const pass = await sourcesPass(database.db, config, {
            trigger: command === 'sources:test' ? 'test' : 'manual',
            email: values.email,
            sources: values.source,
            queue: boss,
          });
          if (pass.runs.some((run) => run.status === 'failed')) process.exitCode = 2;
        } finally {
          await boss.stop({ graceful: false });
        }
        break;
      }
      default:
        throw new CliError(`Commande inconnue : ${command}\n\n${HELP}`);
    }
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof PasswordTooWeakError) {
    console.error(
      `Mot de passe refusé : ${PASSWORD_PROBLEMS[error.problem] ?? error.problem}. Choisis une phrase d'au moins 12 caractères.`,
    );
  } else if (error instanceof CliError) {
    console.error(error.message);
  } else {
    console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(1);
});
