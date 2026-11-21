import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, maskUrl } from './index';

describe('maskUrl', () => {
  it('masks API keys carried in query strings', () => {
    expect(
      maskUrl('https://api.adzuna.com/v1/api/jobs/be/search/1?app_id=1&app_key=abc&what=x'),
    ).toBe('https://api.adzuna.com/v1/api/jobs/be/search/1?app_id=1&app_key=[redacted]&what=x');
    expect(maskUrl('/search.json?engine=google_jobs&api_key=s3cr3t')).toBe(
      '/search.json?engine=google_jobs&api_key=[redacted]',
    );
  });

  it('drops fragments, which carry enrollment tokens', () => {
    expect(maskUrl('/enroll#t=abcdef')).toBe('/enroll');
  });

  it('leaves harmless URLs untouched', () => {
    expect(maskUrl('/api/health')).toBe('/api/health');
    expect(maskUrl('/api/audit?limit=20')).toBe('/api/audit?limit=20');
  });
});

describe('createLogger', () => {
  function capture() {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString('utf8'));
        callback();
      },
    });
    return { lines, logger: createLogger({ name: 'test', level: 'info', destination }) };
  }

  it('redacts secrets and personal data', () => {
    const { lines, logger } = capture();
    logger.info(
      { password: 'hunter2', email: 'someone@example.org', body: { code: '123456' } },
      'x',
    );
    const line = lines.join('');
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('someone@example.org');
    expect(line).not.toContain('123456');
    expect(line).toContain('[redacted]');
  });

  it('masks the request URL and drops cookies', () => {
    const { lines, logger } = capture();
    logger.info(
      {
        req: { method: 'GET', url: '/x?token=abc', headers: { cookie: 'a=b' } },
        headers: { cookie: 'session=xyz' },
      },
      'request',
    );
    const line = lines.join('');
    expect(line).not.toContain('token=abc');
    expect(line).not.toContain('session=xyz');
  });
});
