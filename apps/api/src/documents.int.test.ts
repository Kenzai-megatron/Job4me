import type {
  DocumentVersion,
  DocumentVersionsResponse,
  MasterCv,
  MasterCvList,
} from '@job4me/contracts';
import { schema, withUser } from '@job4me/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './testing/app';
import { signedInBrowser } from './testing/session';

// Master CVs from the API side (phase 4 plan, sections 4 and 7; ADR 0020): built from the
// profile without AI, ordered and hidden by Mehdi, a version for each change. A fictitious
// profile only.

let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp({ queue: { send: () => Promise.resolve('job') } });
});

afterAll(async () => {
  await ctx?.close();
});

/** A fictitious profile: a target job, an experience with two achievements, a skill. */
async function profileOf(userId: string) {
  return withUser(ctx.deps.db, userId, async (tx) => {
    const [job] = await tx
      .insert(schema.targetJobs)
      .values({ userId, title: 'Comptable', position: 0 })
      .returning();
    const [experience] = await tx
      .insert(schema.experiences)
      .values({
        userId,
        title: 'Comptable',
        employer: 'Exemple SA',
        startMonth: '2021-09',
        current: true,
      })
      .returning();
    const facts = await tx
      .insert(schema.facts)
      .values([
        {
          userId,
          text: 'Clôtures mensuelles en 5 jours au lieu de 8',
          experienceId: experience!.id,
        },
        { userId, text: 'Migration vers Winbooks', experienceId: experience!.id },
      ])
      .returning();
    const [skill] = await tx
      .insert(schema.skills)
      .values({ userId, name: 'Winbooks', level: 'expert', years: 4 })
      .returning();
    return { jobId: job!.id, experienceId: experience!.id, facts, skillId: skill!.id };
  });
}

const lines = (cv: MasterCv) =>
  cv.content.sections.flatMap((section) =>
    section.entries.flatMap((entry) => [
      entry.heading.text,
      ...entry.lines.map((line) => line.text),
    ]),
  );

describe('master CVs', () => {
  it('builds one from the profile, every line with its source, for a target job of the account', async () => {
    const { browser, userId } = await signedInBrowser(ctx, 'master-cv');
    const { jobId } = await profileOf(userId);
    const before = (await browser.get('/api/master-cvs')).json<MasterCvList>();
    expect(before.masterCvs).toEqual([
      { targetJobId: jobId, targetJob: 'Comptable', id: null, version: null, updatedAt: null },
    ]);
    const created = await browser.post('/api/master-cvs', { targetJobId: jobId });
    expect(created.statusCode).toBe(200);
    const cv = created.json<MasterCv>();
    expect(cv).toMatchObject({
      targetJob: 'Comptable',
      template: 'classic',
      language: 'fr',
      version: { number: 1, origin: 'profile' },
      stale: false,
    });
    expect(lines(cv)).toEqual([
      'Comptable — Exemple SA',
      'Clôtures mensuelles en 5 jours au lieu de 8',
      'Migration vers Winbooks',
      'Winbooks',
    ]);
    for (const section of cv.content.sections) {
      for (const entry of section.entries) {
        for (const line of [entry.heading, ...entry.lines]) {
          expect(line.origin).toBe('profile');
          expect(line.sources.length).toBeGreaterThan(0);
        }
      }
    }
    // Asked twice: the same master CV.
    const again = (await browser.post('/api/master-cvs', { targetJobId: jobId })).json<MasterCv>();
    expect(again.id).toBe(cv.id);
    const listed = (await browser.get('/api/master-cvs')).json<MasterCvList>();
    expect(listed.masterCvs[0]).toMatchObject({ id: cv.id, version: 1 });
  });

  it('adds a version for each change of Mehdi’s choices, none when nothing changes', async () => {
    const { browser, userId } = await signedInBrowser(ctx, 'master-cv-layout');
    const { jobId, facts, skillId } = await profileOf(userId);
    const cv = (await browser.post('/api/master-cvs', { targetJobId: jobId })).json<MasterCv>();
    const layout = {
      order: [`fact:${facts[1]!.id}`],
      hidden: [`skill:${skillId}`],
      summary: 'Comptable rigoureux.',
    };
    const saved = (
      await browser.send('PUT', `/api/master-cvs/${cv.id}`, { template: 'modern', layout })
    ).json<MasterCv>();
    expect(saved).toMatchObject({ template: 'modern', version: { number: 2, origin: 'layout' } });
    expect(lines(saved)).toEqual([
      'Comptable — Exemple SA',
      'Migration vers Winbooks',
      'Clôtures mensuelles en 5 jours au lieu de 8',
    ]);
    expect(saved.content.summary?.text).toBe('Comptable rigoureux.');
    expect(saved.elements.find((element) => element.key === `skill:${skillId}`)?.hidden).toBe(true);
    const same = (
      await browser.send('PUT', `/api/master-cvs/${cv.id}`, { template: 'modern', layout })
    ).json<MasterCv>();
    expect(same.version.number).toBe(2);

    const versions = (
      await browser.get(`/api/documents/${cv.documentId}/versions`)
    ).json<DocumentVersionsResponse>();
    expect(versions.current).toBe(2);
    expect(versions.versions.map((version) => [version.number, version.origin])).toEqual([
      [2, 'layout'],
      [1, 'profile'],
    ]);
    const first = (
      await browser.get(`/api/documents/${cv.documentId}/versions/1`)
    ).json<DocumentVersion>();
    expect(first.content).toMatchObject({ kind: 'cv', template: 'classic', summary: null });
  });

  it('says when the profile moved on, and follows it on demand', async () => {
    const { browser, userId } = await signedInBrowser(ctx, 'master-cv-stale');
    const { jobId, experienceId } = await profileOf(userId);
    const cv = (await browser.post('/api/master-cvs', { targetJobId: jobId })).json<MasterCv>();
    await withUser(ctx.deps.db, userId, (tx) =>
      tx.insert(schema.facts).values({ userId, text: 'Budget de 2 M€ suivi', experienceId }),
    );
    const stale = (await browser.get(`/api/master-cvs/${cv.id}`)).json<MasterCv>();
    expect(stale).toMatchObject({ stale: true, version: { number: 1 } });
    expect(lines(stale)).not.toContain('Budget de 2 M€ suivi');
    const refreshed = (await browser.post(`/api/master-cvs/${cv.id}/refresh`)).json<MasterCv>();
    expect(refreshed).toMatchObject({ stale: false, version: { number: 2, origin: 'profile' } });
    expect(lines(refreshed)).toContain('Budget de 2 M€ suivi');
  });

  it('refuses a layout out of bounds', async () => {
    const { browser, userId } = await signedInBrowser(ctx, 'master-cv-bounds');
    const { jobId } = await profileOf(userId);
    const cv = (await browser.post('/api/master-cvs', { targetJobId: jobId })).json<MasterCv>();
    for (const layout of [
      { order: ['<script>'], hidden: [], summary: null },
      { order: [], hidden: [], summary: 'x'.repeat(601) },
    ]) {
      expect(
        (await browser.send('PUT', `/api/master-cvs/${cv.id}`, { template: 'classic', layout }))
          .statusCode,
      ).toBe(400);
    }
    expect(
      (
        await browser.send('PUT', `/api/master-cvs/${cv.id}`, {
          template: 'fancy',
          layout: { order: [], hidden: [], summary: null },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('never shows nor changes the CV, versions or target job of another account', async () => {
    const alice = await signedInBrowser(ctx, 'master-cv-alice');
    const bob = await signedInBrowser(ctx, 'master-cv-bob');
    const { jobId } = await profileOf(alice.userId);
    const cv = (
      await alice.browser.post('/api/master-cvs', { targetJobId: jobId })
    ).json<MasterCv>();
    expect((await bob.browser.post('/api/master-cvs', { targetJobId: jobId })).statusCode).toBe(
      404,
    );
    expect((await bob.browser.get(`/api/master-cvs/${cv.id}`)).statusCode).toBe(404);
    expect(
      (
        await bob.browser.send('PUT', `/api/master-cvs/${cv.id}`, {
          template: 'classic',
          layout: { order: [], hidden: [], summary: 'Volé' },
        })
      ).statusCode,
    ).toBe(404);
    expect((await bob.browser.post(`/api/master-cvs/${cv.id}/refresh`)).statusCode).toBe(404);
    expect((await bob.browser.get(`/api/documents/${cv.documentId}/versions`)).statusCode).toBe(
      404,
    );
    expect((await bob.browser.get(`/api/documents/${cv.documentId}/versions/1`)).statusCode).toBe(
      404,
    );
    expect((await bob.browser.get('/api/master-cvs')).json<MasterCvList>().masterCvs).toEqual([]);
  });

  it('needs a session', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/master-cvs' });
    expect(response.statusCode).toBe(401);
  });
});
