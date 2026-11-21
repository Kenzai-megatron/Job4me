import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, loadSecrets, readSecret } from './load';

const repoDefault = readFileSync(join(import.meta.dirname, '../../../config/default.yaml'), 'utf8');

function makeRepo(local?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'job4me-config-'));
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'default.yaml'), repoDefault);
  if (local !== undefined) writeFileSync(join(root, 'config', 'local.yaml'), local);
  return root;
}

describe('loadConfig', () => {
  it('loads the repository defaults', () => {
    const config = loadConfig({ cwd: makeRepo(), env: { JOB4ME_ENV: 'test' } });
    expect(config.env).toBe('test');
    expect(config.settings.auth.session.idleTimeoutMinutes).toBe(720);
    expect(config.allowedOrigins).toEqual(['http://localhost:5173', 'http://localhost:3000']);
  });

  it('merges local.yaml and environment overrides', () => {
    const root = makeRepo('auth:\n  lockout:\n    threshold: 7\n');
    const config = loadConfig({
      cwd: root,
      env: {
        JOB4ME_ENV: 'production',
        JOB4ME_PUBLIC_ORIGIN: 'https://job4me.example.ts.net',
        JOB4ME_RP_ID: 'job4me.example.ts.net',
        JOB4ME_SMTP_HOST: 'smtp.example.org',
        JOB4ME_SMTP_PORT: '587',
      },
    });
    expect(config.settings.auth.lockout.threshold).toBe(7);
    expect(config.settings.app.publicOrigin).toBe('https://job4me.example.ts.net');
    expect(config.settings.mail.smtpHost).toBe('smtp.example.org');
  });

  it('rejects a value outside its bounds', () => {
    const root = makeRepo('auth:\n  password:\n    argon2:\n      memoryKiB: 1024\n');
    expect(() => loadConfig({ cwd: root, env: { JOB4ME_ENV: 'test' } })).toThrow(ConfigError);
  });

  it('refuses a real mail server outside production', () => {
    expect(() =>
      loadConfig({
        cwd: makeRepo(),
        env: { JOB4ME_ENV: 'development', JOB4ME_SMTP_HOST: 'smtp.gmail.com' },
      }),
    ).toThrow(/Mailpit/);
  });

  it('requires https in production for a non-local origin', () => {
    expect(() =>
      loadConfig({
        cwd: makeRepo(),
        env: {
          JOB4ME_ENV: 'production',
          JOB4ME_PUBLIC_ORIGIN: 'http://job4me.example.org',
          JOB4ME_RP_ID: 'job4me.example.org',
        },
      }),
    ).toThrow(/https/);
  });

  it('requires the RP ID to match the public origin', () => {
    expect(() =>
      loadConfig({
        cwd: makeRepo(),
        env: { JOB4ME_ENV: 'test', JOB4ME_RP_ID: 'evil.example' },
      }),
    ).toThrow(ConfigError);
  });

  it('rejects an unknown environment', () => {
    expect(() => loadConfig({ cwd: makeRepo(), env: { JOB4ME_ENV: 'staging' } })).toThrow(
      ConfigError,
    );
  });
});

describe('secrets', () => {
  it('reads a secret from a *_FILE variable', () => {
    const file = join(makeRepo(), 'secret.txt');
    writeFileSync(file, 'from-file\n');
    expect(readSecret('SOME_SECRET', { SOME_SECRET_FILE: file })).toBe('from-file');
  });

  it('fails when a required secret is missing', () => {
    expect(() => loadSecrets({ JOB4ME_DATABASE_URL: 'postgres://x' })).toThrow(/JOB4ME_MASTER_KEY/);
  });
});
