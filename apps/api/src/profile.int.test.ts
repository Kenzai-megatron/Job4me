import { rawConnection } from '@job4me/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './testing/app';
import { signedInBrowser } from './testing/session';

let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx?.close();
});

/** One valid body per list rubric. */
const samples: Record<string, Record<string, unknown>> = {
  'target-jobs': { title: 'Contrôleur de gestion' },
  keywords: { keyword: 'contrôle de gestion', language: 'fr', priority: true },
  sectors: { sector: 'Industrie', kind: 'preferred' },
  skills: { name: 'Excel', level: 'expert', years: 8 },
  languages: { language: 'nl', overall: 'B2', speaking: 'B1' },
  experiences: { title: 'Analyste financier', employer: 'Exemple SA', startMonth: '2019-09' },
  facts: { text: 'Réduit de 30 % le délai de clôture mensuelle.' },
  education: { degree: 'Master en sciences de gestion', institution: 'Université X', year: 2018 },
  certifications: { name: 'Power BI Data Analyst', issuer: 'Microsoft', year: 2023 },
  eliminations: { kind: 'language', value: 'allemand courant exigé' },
  'title-filters': { list: 'reject', expression: 'stagiaire' },
  'excluded-companies': { name: 'Employeur Actuel SA', reason: 'employeur actuel' },
};

describe('profile rubrics', () => {
  it('creates, lists, updates and deletes an entry in every list rubric', async () => {
    const { browser } = await signedInBrowser(ctx, 'rubrics');
    for (const [slug, body] of Object.entries(samples)) {
      const created = await browser.post(`/api/profile/${slug}`, body);
      expect(created.statusCode, slug).toBe(200);
      const item = created.json<{ id: string }>();
      expect(item).toMatchObject(body);
      const list = (await browser.get(`/api/profile/${slug}`)).json<{ items: unknown[] }>();
      expect(list.items, slug).toHaveLength(1);
      const removed = await browser.send('DELETE', `/api/profile/${slug}/${item.id}`);
      expect(removed.statusCode, slug).toBe(200);
      expect((await browser.get(`/api/profile/${slug}`)).json()).toEqual({ items: [] });
    }
  });

  it('keeps the fields a change leaves out', async () => {
    const { browser } = await signedInBrowser(ctx, 'patch');
    const skill = (await browser.post('/api/profile/skills', samples.skills)).json<{
      id: string;
    }>();
    const patched = await browser.send('PATCH', `/api/profile/skills/${skill.id}`, {
      name: 'Microsoft Excel',
    });
    expect(patched.json()).toMatchObject({ name: 'Microsoft Excel', level: 'expert', years: 8 });

    const experience = (await browser.post('/api/profile/experiences', samples.experiences)).json<{
      id: string;
    }>();
    const fact = (
      await browser.post('/api/profile/facts', { ...samples.facts, experienceId: experience.id })
    ).json<{ id: string }>();
    const changed = await browser.send('PATCH', `/api/profile/facts/${fact.id}`, {
      text: 'Réduit de 35 % le délai de clôture mensuelle.',
    });
    expect(changed.json()).toMatchObject({ experienceId: experience.id, origin: 'manual' });
  });

  it('refuses duplicates, invalid values and entries beyond the limits', async () => {
    const { browser } = await signedInBrowser(ctx, 'limits');
    expect((await browser.post('/api/profile/keywords', samples.keywords)).statusCode).toBe(200);
    const duplicate = await browser.post('/api/profile/keywords', {
      ...samples.keywords,
      keyword: 'Contrôle de Gestion',
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: 'duplicate' });

    const invalid = await browser.post('/api/profile/languages', { language: 'nl', overall: 'D1' });
    expect(invalid.statusCode).toBe(400);
    const badMonth = await browser.post('/api/profile/experiences', {
      ...samples.experiences,
      startMonth: '2019-13',
    });
    expect(badMonth.statusCode).toBe(400);

    const max = ctx.deps.config.settings.profile.maxTargetJobs;
    for (let n = 0; n < max; n++) {
      expect(
        (await browser.post('/api/profile/target-jobs', { title: `Métier ${n}` })).statusCode,
      ).toBe(200);
    }
    const beyond = await browser.post('/api/profile/target-jobs', { title: 'Un de trop' });
    expect(beyond.statusCode).toBe(409);
    expect(beyond.json()).toMatchObject({ error: 'limit_reached' });
  });
});

describe('isolation between accounts (ADR 0011)', () => {
  it('never shows, changes or deletes the entries of another account', async () => {
    const a = await signedInBrowser(ctx, 'alice');
    const b = await signedInBrowser(ctx, 'bob');
    const experience = (
      await a.browser.post('/api/profile/experiences', samples.experiences)
    ).json<{
      id: string;
    }>();
    expect((await b.browser.get('/api/profile/experiences')).json()).toEqual({ items: [] });
    const patch = await b.browser.send('PATCH', `/api/profile/experiences/${experience.id}`, {
      title: 'Piraté',
    });
    expect(patch.statusCode).toBe(404);
    expect(
      (await b.browser.send('DELETE', `/api/profile/experiences/${experience.id}`)).statusCode,
    ).toBe(404);
    const foreignFact = await b.browser.post('/api/profile/facts', {
      text: 'Lien vers une expérience étrangère',
      experienceId: experience.id,
    });
    expect(foreignFact.statusCode).toBe(400);
    expect(
      (await a.browser.get('/api/profile/experiences')).json<{ items: unknown[] }>().items,
    ).toHaveLength(1);
  });

  it('hides every row from a query that sets no user, even without a user_id filter', async () => {
    const a = await signedInBrowser(ctx, 'rls-a');
    const b = await signedInBrowser(ctx, 'rls-b');
    await a.browser.post('/api/profile/skills', samples.skills);
    const client = await rawConnection(ctx.database.appUrl);
    try {
      const countSkills = async () =>
        Number((await client.query<{ n: string }>('select count(*) as n from skill')).rows[0]!.n);
      expect(await countSkills()).toBe(0);
      await client.query('begin');
      await client.query("select set_config('app.user_id', $1, true)", [b.userId]);
      expect(await countSkills()).toBe(0);
      await expect(
        client.query("insert into skill (user_id, name) values ($1, 'Injecté')", [a.userId]),
      ).rejects.toThrow(/row-level security/);
      await client.query('rollback');
      await client.query('begin');
      await client.query("select set_config('app.user_id', $1, true)", [a.userId]);
      expect(await countSkills()).toBe(1);
      await client.query('rollback');
    } finally {
      await client.end();
    }
  });
});

describe('profile document and identity', () => {
  it('returns defaults, then keeps what a change leaves out', async () => {
    const { browser } = await signedInBrowser(ctx, 'document');
    const empty = (await browser.get('/api/profile')).json<Record<string, unknown>>();
    expect(empty).toMatchObject({
      baseCity: null,
      contractTypes: [],
      defaultRadiusKm: 40,
      baseLocation: { status: 'missing', name: null, postalCode: null },
    });
    await browser.send('PATCH', '/api/profile', {
      baseCity: 'Bruxelles',
      basePostalCode: '1000',
      contractTypes: ['permanent'],
    });
    const saved = await browser.send('PATCH', '/api/profile', { workRegimes: ['full_time'] });
    expect(saved.json()).toMatchObject({
      baseCity: 'Bruxelles',
      contractTypes: ['permanent'],
      workRegimes: ['full_time'],
      // The base city read in the localities (ADR 0017): « Bruxelles, 1000 : trouvée ».
      baseLocation: { status: 'found', name: 'Bruxelles', postalCode: '1000' },
    });
    const malines = await browser.send('PATCH', '/api/profile', {
      baseCity: 'Malines',
      basePostalCode: null,
    });
    expect(malines.json()).toMatchObject({
      baseLocation: { status: 'found', name: 'Mechelen', postalCode: '2800' },
    });
    const nowhere = await browser.send('PATCH', '/api/profile', { baseCity: 'Nulle part' });
    expect(nowhere.json()).toMatchObject({
      baseLocation: { status: 'unknown', name: null, postalCode: null },
    });
  });

  it('keeps identity and contact details encrypted at rest', async () => {
    const { browser, userId } = await signedInBrowser(ctx, 'identity');
    const identity = {
      fullName: 'Prénom Nom',
      email: 'prenom.nom@example.org',
      phone: '+32 470 12 34 56',
      commune: 'Ixelles',
      drivingLicences: ['B'],
      transport: ['car', 'public_transport'],
    };
    expect((await browser.send('PUT', '/api/profile/identity', identity)).statusCode).toBe(200);
    expect((await browser.get('/api/profile/identity')).json()).toEqual(identity);
    const owner = await rawConnection(ctx.database.ownerUrl);
    try {
      const { rows } = await owner.query<{ ciphertext: Buffer }>(
        'select ciphertext from profile_identity where user_id = $1',
        [userId],
      );
      const raw = rows[0]!.ciphertext.toString('latin1');
      expect(raw).not.toContain('example.org');
      expect(raw).not.toContain('Ixelles');
    } finally {
      await owner.end();
    }
  });
});

describe('completeness', () => {
  it('weighs each rubric from the configuration', async () => {
    const { browser } = await signedInBrowser(ctx, 'complete');
    const start = (await browser.get('/api/profile/completeness')).json<{ percent: number }>();
    expect(start.percent).toBe(0);
    await browser.send('PUT', '/api/profile/identity', {
      fullName: 'Prénom Nom',
      email: 'prenom.nom@example.org',
      phone: '+32 470 12 34 56',
      commune: null,
      drivingLicences: [],
      transport: [],
    });
    await browser.send('PATCH', '/api/profile', {
      baseCity: 'Bruxelles',
      contractTypes: ['permanent'],
      workRegimes: ['full_time'],
    });
    await browser.post('/api/profile/target-jobs', samples['target-jobs']);
    await browser.post('/api/profile/skills', samples.skills);
    const after = (await browser.get('/api/profile/completeness')).json<{
      percent: number;
      rubrics: { rubric: string; done: boolean; count: number }[];
    }>();
    const weights = ctx.deps.config.settings.profile.completeness;
    const expected =
      weights.identity.weight +
      weights.practical.weight +
      weights.targetJobs.weight +
      weights.skills.weight / weights.skills.min;
    expect(after.percent).toBe(Math.round(expected));
    expect(after.rubrics.find((r) => r.rubric === 'skills')).toMatchObject({
      count: 1,
      done: false,
    });
  });
});

describe('audit', () => {
  it('records profile changes without their content', async () => {
    const { browser } = await signedInBrowser(ctx, 'audit');
    await browser.post('/api/profile/excluded-companies', samples['excluded-companies']);
    const { entries } = (await browser.get('/api/audit')).json<{
      entries: { action: string; metadata: Record<string, unknown> }[];
    }>();
    const event = entries.find((entry) => entry.action === 'profile.changed');
    expect(event?.metadata).toEqual({ rubric: 'excluded-companies', op: 'created' });
    expect(JSON.stringify(entries)).not.toContain('Employeur Actuel');
  });
});
