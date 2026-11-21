import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '@job4me/config';
import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { mailTransport, sendTestMail } from './mail';

const repoDefault = readFileSync(
  join(import.meta.dirname, '../../../../config/default.yaml'),
  'utf8',
);

function configFor(env: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'job4me-mail-'));
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'default.yaml'), repoDefault);
  return loadConfig({ cwd: root, env });
}

describe('mail:test', () => {
  it('sends one French message from the configured address', async () => {
    const config = configFor({ JOB4ME_ENV: 'test' });
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const sent: string[] = [];
    const original = transport.sendMail.bind(transport);
    transport.sendMail = async (message: Parameters<typeof original>[0]) => {
      const info = await original(message);
      sent.push(String(info.message));
      return info;
    };
    await sendTestMail(config, 'mehdi@example.org', transport);
    const message = JSON.parse(sent[0]!) as { subject: string; to: { address: string }[] };
    expect(message.subject).toBe('Job4me : mail de test');
    expect(message.to[0]!.address).toBe('mehdi@example.org');
  });

  it('points the transport at Mailpit outside production', () => {
    const config = configFor({ JOB4ME_ENV: 'development' });
    const options = (
      mailTransport(config) as unknown as { options: { host: string; port: number } }
    ).options;
    expect([options.host, options.port]).toEqual(['127.0.0.1', 1025]);
  });

  it('refuses to run in production', async () => {
    const config = configFor({
      JOB4ME_ENV: 'production',
      JOB4ME_PUBLIC_ORIGIN: 'https://job4me.example.ts.net',
      JOB4ME_RP_ID: 'job4me.example.ts.net',
    });
    const transport = nodemailer.createTransport({ jsonTransport: true });
    await expect(sendTestMail(config, 'mehdi@example.org', transport)).rejects.toThrow(/Mailpit/);
  });
});
