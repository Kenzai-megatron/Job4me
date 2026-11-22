import type { Config } from '@job4me/config';
import { resources } from '@job4me/i18n';
import nodemailer, { type Transporter } from 'nodemailer';
import { CliError } from './commands';

/** SMTP transport from the configuration; loadConfig only accepts Mailpit outside production. */
export function mailTransport(config: Config): Transporter {
  const { smtpHost, smtpPort } = config.settings.mail;
  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: false,
    ignoreTLS: true,
  });
}

/**
 * `mail:test`: one plain message through the configured server, to check the development mail
 * path end to end. Refused in production: real mail goes through Gmail, in a later phase.
 */
export async function sendTestMail(
  config: Config,
  to: string,
  transport: Transporter = mailTransport(config),
) {
  if (config.env === 'production') {
    throw new CliError(
      'mail:test vérifie Mailpit en développement ; en production, aucun mail ne part en phase 0.',
    );
  }
  const texts = resources.fr.translation.mail;
  const info = await transport.sendMail({
    from: config.settings.mail.from,
    to,
    subject: texts.testSubject,
    text: texts.testBody,
  });
  return { messageId: info.messageId };
}
