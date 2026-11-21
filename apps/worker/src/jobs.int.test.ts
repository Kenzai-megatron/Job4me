import { randomBytes } from 'node:crypto';
import { loadConfig } from '@job4me/config';
import { connect, type DatabaseHandle, queueOptions, schema } from '@job4me/db';
import { createTestDatabase, type TestDatabase } from '@job4me/db/testing';
import { createLogger } from '@job4me/logger';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purgeExpired } from './jobs/purge';
import { sendTestNotification } from './jobs/push-test';

let database: TestDatabase;
let handle: DatabaseHandle;
let userId: string;

beforeAll(async () => {
  database = await createTestDatabase('worker');
  handle = connect(database.appUrl, { max: 2 });
  const [user] = await handle.db
    .insert(schema.users)
    .values({ email: 'worker@example.org', displayName: 'W', webauthnUserHandle: randomBytes(32) })
    .returning();
  userId = user!.id;
});

afterAll(async () => {
  await handle?.close();
  await database?.drop();
});

const logger = createLogger({ name: 'test', level: 'silent' });
const vapid = { subject: 'mailto:test@example.org', publicKey: 'p', privateKey: 'k' };

describe('push test job', () => {
  it('delivers to every device, forgets departed ones and records the outcome', async () => {
    await handle.db.insert(schema.pushSubscriptions).values([
      { userId, endpoint: 'https://fcm.googleapis.com/fcm/send/alive', p256dh: 'a', auth: 'b' },
      { userId, endpoint: 'https://web.push.apple.com/gone', p256dh: 'a', auth: 'b' },
    ]);
    const sent: string[] = [];
    const result = await sendTestNotification(
      {
        db: handle.db,
        logger,
        vapid,
        send: (async (subscription: { endpoint: string }, payload: string) => {
          sent.push(payload);
          if (subscription.endpoint.endsWith('/gone')) {
            throw Object.assign(new Error('gone'), { statusCode: 410 });
          }
          return { statusCode: 201, body: '', headers: {} };
        }) as never,
      },
      { userId },
    );
    expect(result).toEqual({ devices: 2, delivered: 1 });
    expect(JSON.parse(sent[0]!)).toMatchObject({ title: 'Job4me', url: '/' });
    const left = await handle.db.select().from(schema.pushSubscriptions);
    expect(left.map((device) => device.endpoint)).toEqual([
      'https://fcm.googleapis.com/fcm/send/alive',
    ]);
    expect(left[0]!.lastSuccessAt).not.toBeNull();
    const audit = await handle.db.select().from(schema.auditLog);
    expect(audit.some((row) => row.action === 'push.test_sent')).toBe(true);
  });
});

describe('purge job', () => {
  it('removes expired challenges and old closed sessions, keeps live ones', async () => {
    process.env.JOB4ME_ENV = 'test';
    const { settings } = loadConfig();
    const now = new Date();
    const longAgo = new Date(now.getTime() - 60 * 24 * 3600 * 1000);
    await handle.db.insert(schema.authChallenges).values([
      { purpose: 'authentication', bindingHash: randomBytes(32), expiresAt: longAgo },
      {
        purpose: 'authentication',
        bindingHash: randomBytes(32),
        expiresAt: new Date(now.getTime() + 60_000),
      },
    ]);
    await handle.db.insert(schema.sessions).values([
      {
        userId,
        tokenHash: randomBytes(32),
        authMethod: 'passkey',
        lastSeenAt: longAgo,
        idleExpiresAt: longAgo,
        absoluteExpiresAt: longAgo,
        reauthenticatedAt: longAgo,
      },
      {
        userId,
        tokenHash: randomBytes(32),
        authMethod: 'passkey',
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + 3_600_000),
        absoluteExpiresAt: new Date(now.getTime() + 3_600_000),
        reauthenticatedAt: now,
      },
    ]);
    const result = await purgeExpired(handle.db, settings, now);
    expect(result).toMatchObject({ challenges: 1, sessions: 1 });
    expect(await handle.db.select().from(schema.authChallenges)).toHaveLength(1);
    expect(await handle.db.select().from(schema.sessions)).toHaveLength(1);
  });
});

describe('queue', () => {
  it('runs on the runtime role, inside the schema the migrations created', async () => {
    const boss = new PgBoss({
      ...queueOptions(database.appUrl),
      supervise: false,
      schedule: false,
    });
    const errors: unknown[] = [];
    boss.on('error', (error) => errors.push(error));
    await boss.start();
    try {
      await boss.createQueue('integration_check');
      const id = await boss.send('integration_check', { hello: 'world' });
      const [job] = await boss.fetch<{ hello: string }>('integration_check');
      expect(job?.id).toBe(id);
      expect(job?.data).toEqual({ hello: 'world' });
      await boss.complete('integration_check', job!.id);
    } finally {
      await boss.stop({ graceful: false });
    }
    expect(errors).toEqual([]);
  });
});
