import { randomUUID } from 'node:crypto';
import type { Identity, ImportReview, Proposal } from '@job4me/contracts';
import { eq, schema, withUser } from '@job4me/db';
import { rawConnection } from '@job4me/db/testing';
import { aadFor, encrypt, randomToken } from '@job4me/security';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './testing/app';
import { signedInBrowser } from './testing/session';

// Field-by-field review (plan, section 4, step 5): nothing enters the profile without Mehdi.

let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx?.close();
});

type Draft = {
  rubric: string;
  source: 'local' | 'ai' | 'linkedin';
  content: Record<string, unknown>;
};

/** An import as the worker leaves it: in review, with its proposals encrypted. */
async function inReview(userId: string, drafts: Draft[]): Promise<string> {
  return withUser(ctx.deps.db, userId, async (tx) => {
    const [upload] = await tx
      .insert(schema.uploads)
      .values({
        userId,
        kind: 'cv_pdf',
        sizeBytes: 1,
        sha256: '0'.repeat(64),
        storageKey: randomToken(32),
      })
      .returning({ id: schema.uploads.id });
    const [run] = await tx
      .insert(schema.importRuns)
      .values({ userId, uploadId: upload!.id, status: 'review', extracted: Buffer.from('x') })
      .returning({ id: schema.importRuns.id });
    await tx.insert(schema.importProposals).values(
      drafts.map((draft, position) => {
        const id = randomUUID();
        return {
          id,
          userId,
          importRunId: run!.id,
          rubric: draft.rubric,
          source: draft.source,
          position,
          content: encrypt(
            ctx.deps.imports.key,
            JSON.stringify(draft.content),
            aadFor('import_proposal', 'content', id),
          ),
        };
      }),
    );
    return run!.id;
  });
}

const DRAFTS: Draft[] = [
  {
    rubric: 'identity',
    source: 'local',
    content: { field: 'email', value: 'alex@example.org', evidence: 'alex@example.org' },
  },
  {
    rubric: 'experiences',
    source: 'ai',
    content: {
      title: 'Analyste de données',
      employer: 'Démo SA',
      location: 'Bruxelles',
      startMonth: '2022-03',
      endMonth: null,
      current: true,
      evidence: 'Analyste de données, Démo SA',
    },
  },
  {
    rubric: 'facts',
    source: 'ai',
    content: {
      text: 'Réduit de 30 % le délai de clôture',
      experience: 1,
      evidence: 'Réduit de 30 %',
    },
  },
  { rubric: 'skills', source: 'ai', content: { name: 'SQL', level: null, evidence: 'SQL' } },
  { rubric: 'skills', source: 'ai', content: { name: 'Excel', level: null, evidence: 'Excel' } },
  {
    rubric: 'languages',
    source: 'ai',
    content: { language: 'nl', overall: null, evidence: 'néerlandais' },
  },
  {
    rubric: 'saved-offers',
    source: 'linkedin',
    content: {
      rows: [
        {
          title: 'Data Analyst',
          company: 'Exemple SA',
          url: 'https://www.linkedin.com/jobs/view/1',
          date: '2026-11-03',
        },
      ],
      evidence: 'Saved Jobs.csv : 1',
    },
  },
];

describe('import review', () => {
  it('shows the proposals with their evidence and flags possible duplicates', async () => {
    const { browser, userId } = await signedInBrowser(ctx, 'review-list');
    await browser.post('/api/profile/skills', { name: 'sql' });
    const runId = await inReview(userId, DRAFTS);
    const review = (await browser.get(`/api/imports/${runId}/proposals`)).json<ImportReview>();
    expect(review.run).toMatchObject({ id: runId, status: 'review' });
    expect(review.proposals.map((proposal) => proposal.rubric)).toEqual(
      DRAFTS.map((draft) => draft.rubric),
    );
    const skill = review.proposals.find((proposal) => proposal.content.name === 'SQL')!;
    expect(skill).toMatchObject({
      decision: 'pending',
      duplicate: true,
      content: { evidence: 'SQL' },
    });
    expect(review.proposals.find((proposal) => proposal.content.name === 'Excel')!.duplicate).toBe(
      false,
    );
  });

  it('applies each decision to its rubric, links facts, and closes the import', async () => {
    const { browser, userId } = await signedInBrowser(ctx, 'review-apply');
    const runId = await inReview(userId, DRAFTS);
    const review = (await browser.get(`/api/imports/${runId}/proposals`)).json<ImportReview>();
    const [email, experience, fact, sql, excel, language, saved] = review.proposals;
    const decide = (proposal: Proposal, body: Record<string, unknown>) =>
      browser.post(`/api/imports/${runId}/proposals/${proposal.id}/decision`, body);

    expect((await decide(email!, { decision: 'accept' })).json()).toMatchObject({
      decision: 'accepted',
    });
    expect((await decide(experience!, { decision: 'accept' })).statusCode).toBe(200);
    expect((await decide(fact!, { decision: 'accept' })).statusCode).toBe(200);
    // Corrected: Mehdi changes the level before keeping it.
    const corrected = await decide(sql!, { decision: 'accept', content: { level: 'advanced' } });
    expect(corrected.json()).toMatchObject({
      decision: 'corrected',
      content: { name: 'SQL', level: 'advanced' },
    });
    expect((await decide(excel!, { decision: 'ignore' })).json()).toMatchObject({
      decision: 'ignored',
    });
    // A language needs its level: refused as proposed, accepted once corrected.
    expect((await decide(language!, { decision: 'accept' })).statusCode).toBe(400);
    expect(
      (await decide(language!, { decision: 'accept', content: { overall: 'B2' } })).statusCode,
    ).toBe(200);
    expect((await decide(saved!, { decision: 'accept' })).statusCode).toBe(200);

    const identity = (await browser.get('/api/profile/identity')).json<Identity>();
    expect(identity.email).toBe('alex@example.org');
    const experiences = (await browser.get('/api/profile/experiences')).json<{
      items: { id: string; title: string }[];
    }>();
    expect(experiences.items.map((item) => item.title)).toEqual(['Analyste de données']);
    const facts = (await browser.get('/api/profile/facts')).json<{
      items: { experienceId: string; origin: string }[];
    }>();
    expect(facts.items).toEqual([
      expect.objectContaining({ experienceId: experiences.items[0]!.id, origin: 'cv_import' }),
    ]);
    const skills = (await browser.get('/api/profile/skills')).json<{
      items: { name: string; level: string }[];
    }>();
    expect(skills.items).toEqual([expect.objectContaining({ name: 'SQL', level: 'advanced' })]);
    const languages = (await browser.get('/api/profile/languages')).json<{
      items: { language: string; overall: string }[];
    }>();
    expect(languages.items).toEqual([expect.objectContaining({ language: 'nl', overall: 'B2' })]);

    const after = (await browser.get(`/api/imports/${runId}`)).json<{ status: string }>();
    expect(after.status).toBe('applied');
    await withUser(ctx.deps.db, userId, async (tx) => {
      const offers = await tx
        .select()
        .from(schema.savedOffers)
        .where(eq(schema.savedOffers.userId, userId));
      expect(offers).toEqual([
        expect.objectContaining({ title: 'Data Analyst', savedOn: '2026-11-03' }),
      ]);
    });

    const db = await rawConnection(ctx.database.ownerUrl);
    try {
      const audit = await db.query<{ metadata: Record<string, string> }>(
        "select metadata from audit_log where action = 'import.proposal_decided' and actor_user_id = $1 order by occurred_at",
        [userId],
      );
      expect(audit.rows.map((row) => row.metadata.decision)).toEqual([
        'accepted',
        'accepted',
        'accepted',
        'corrected',
        'ignored',
        'corrected',
        'accepted',
      ]);
    } finally {
      await db.end();
    }
  });

  it('decides once, and only on the signed-in user’s own imports', async () => {
    const alice = await signedInBrowser(ctx, 'review-alice');
    const bob = await signedInBrowser(ctx, 'review-bob');
    const runId = await inReview(alice.userId, [DRAFTS[3]!]);
    const review = (
      await alice.browser.get(`/api/imports/${runId}/proposals`)
    ).json<ImportReview>();
    const proposal = review.proposals[0]!;
    const url = `/api/imports/${runId}/proposals/${proposal.id}/decision`;

    expect((await bob.browser.get(`/api/imports/${runId}/proposals`)).statusCode).toBe(404);
    expect((await bob.browser.post(url, { decision: 'accept' })).statusCode).toBe(404);
    expect((await alice.browser.post(url, { decision: 'ignore' })).statusCode).toBe(200);
    const again = await alice.browser.post(url, { decision: 'accept' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'already_decided' });
    // Bob's profile is untouched.
    const theirs = (await bob.browser.get('/api/profile/skills')).json<{ items: unknown[] }>();
    expect(theirs.items).toEqual([]);
  });

  it('keeps proposals unreadable in the database', async () => {
    const { userId } = await signedInBrowser(ctx, 'review-raw');
    await inReview(userId, [DRAFTS[1]!]);
    const db = await rawConnection(ctx.database.ownerUrl);
    try {
      const { rows } = await db.query<{ content: Buffer }>(
        'select content from import_proposal where user_id = $1 order by position',
        [userId],
      );
      expect(rows[0]!.content.toString('latin1')).not.toContain('Démo SA');
    } finally {
      await db.end();
    }
  });
});
