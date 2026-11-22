// Targets for `semgrep --test .semgrep`: each annotation says whether the next line must match.
import nodemailer from 'nodemailer';
// ruleid: job4me-no-direct-http
import { request } from 'undici';

export async function samples(app: { inject: (options: object) => Promise<unknown> }) {
  // ruleid: job4me-no-direct-http
  await fetch('https://example.org/jobs');
  // ok: job4me-no-direct-http
  await app.inject({ method: 'GET', url: '/api/health' });

  // ruleid: job4me-no-math-random
  const weak = Math.random();
  // ok: job4me-no-math-random
  const strong = crypto.getRandomValues(new Uint32Array(1))[0];

  // ruleid: job4me-mail-host-from-config
  nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587 });
  // ok: job4me-mail-host-from-config
  nodemailer.createTransport({ host: settings.mail.smtpHost, port: settings.mail.smtpPort });

  // ruleid: job4me-no-sql-raw
  await db.execute(sql.raw(`select * from users where email = '${email}'`));
  // ok: job4me-no-sql-raw
  await db.execute(sql`select * from users where email = ${email}`);

  // ruleid: job4me-no-eval
  eval(code);
  // ruleid: job4me-no-eval
  const built = new Function('return 1');
  return { request, weak, strong, built };
}
