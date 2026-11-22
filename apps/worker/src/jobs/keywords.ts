import type { Settings } from '@job4me/config';
import { type KeywordsProposeJob, keywordProposalSchema } from '@job4me/contracts';
import { and, asc, count, type Database, eq, schema, withUser } from '@job4me/db';
import type { Logger } from '@job4me/logger';
import { keywordPrompt, wrap } from '../ai/prompts';
import type { AiService } from '../ai/service';

// Keyword proposal (plan, section 5): target jobs, skills, sectors and languages go to Claude
// Sonnet 5.5 (never the identity). Its keywords join the profile as "proposed", for Mehdi to
// keep, change or set aside; only validated keywords will feed the collection (phase 2).

export interface KeywordDeps {
  db: Database;
  ai: AiService;
  settings: Settings;
  logger: Logger;
}

function clean(keyword: string): string {
  return keyword.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export async function proposeKeywords(deps: KeywordDeps, job: KeywordsProposeJob): Promise<void> {
  const { userId, runId } = job;
  const runs = schema.keywordProposalRuns;
  const [started] = await withUser(deps.db, userId, (tx) =>
    tx
      .update(runs)
      .set({ status: 'running', updatedAt: new Date() })
      .where(and(eq(runs.id, runId), eq(runs.userId, userId), eq(runs.status, 'queued')))
      .returning({ id: runs.id }),
  );
  if (!started) return;

  // Only what the task needs (data minimisation): no identity, no motivations, no employer.
  const profile = await withUser(deps.db, userId, async (tx) => ({
    targetJobs: (
      await tx
        .select({ title: schema.targetJobs.title })
        .from(schema.targetJobs)
        .where(eq(schema.targetJobs.userId, userId))
        .orderBy(asc(schema.targetJobs.position))
    ).map((row) => row.title),
    experiences: (
      await tx
        .select({ title: schema.experiences.title })
        .from(schema.experiences)
        .where(eq(schema.experiences.userId, userId))
    ).map((row) => row.title),
    skills: await tx
      .select({ name: schema.skills.name, level: schema.skills.level })
      .from(schema.skills)
      .where(eq(schema.skills.userId, userId)),
    sectors: await tx
      .select({ sector: schema.sectorPreferences.sector, kind: schema.sectorPreferences.kind })
      .from(schema.sectorPreferences)
      .where(eq(schema.sectorPreferences.userId, userId)),
    languages: await tx
      .select({ language: schema.languageLevels.language, level: schema.languageLevels.overall })
      .from(schema.languageLevels)
      .where(eq(schema.languageLevels.userId, userId)),
    existing: await tx
      .select({ keyword: schema.searchKeywords.keyword, language: schema.searchKeywords.language })
      .from(schema.searchKeywords)
      .where(eq(schema.searchKeywords.userId, userId)),
  }));

  const result = await deps.ai.run({
    usage: 'keywords',
    userId,
    model: deps.settings.ai.keywords.model,
    maxTokens: deps.settings.ai.keywords.maxTokens,
    effort: deps.settings.ai.keywords.effort,
    fallbacks: deps.settings.ai.keywords.fallbacks,
    system: keywordPrompt(deps.settings),
    user: wrap('profil', JSON.stringify(profile, null, 2)),
    schema: keywordProposalSchema,
  });
  if (!result.ok) {
    await withUser(deps.db, userId, (tx) =>
      tx
        .update(runs)
        .set({ status: 'failed', errorCode: result.error, updatedAt: new Date() })
        .where(and(eq(runs.id, runId), eq(runs.userId, userId))),
    );
    deps.logger.info({ runId, aiError: result.error }, 'keyword proposal failed');
    return;
  }

  const { max, priority } = deps.settings.profile.keywords;
  const seen = new Set(
    profile.existing.map((row) => `${row.language}:${clean(row.keyword).toLowerCase()}`),
  );
  const fresh: { keyword: string; language: 'fr' | 'nl' | 'en'; priority: boolean }[] = [];
  let priorities = 0;
  for (const item of result.value.keywords) {
    const keyword = clean(item.keyword);
    const key = `${item.language}:${keyword.toLowerCase()}`;
    if (keyword.length < 2 || keyword.length > 80 || seen.has(key) || fresh.length >= max) continue;
    seen.add(key);
    const isPriority = item.priority && priorities < priority;
    if (isPriority) priorities += 1;
    fresh.push({ keyword, language: item.language, priority: isPriority });
  }

  await withUser(deps.db, userId, async (tx) => {
    // The same ceiling as the API: three times the advised maximum, proposals included.
    const [row] = await tx
      .select({ n: count() })
      .from(schema.searchKeywords)
      .where(eq(schema.searchKeywords.userId, userId));
    const room = Math.max(0, max * 3 - (row?.n ?? 0));
    const kept = fresh.slice(0, room);
    const inserted =
      kept.length === 0
        ? []
        : await tx
            .insert(schema.searchKeywords)
            .values(
              kept.map((item) => ({
                userId,
                keyword: item.keyword,
                language: item.language,
                priority: item.priority,
                status: 'proposed',
                origin: 'ai',
              })),
            )
            .onConflictDoNothing()
            .returning({ id: schema.searchKeywords.id });
    await tx
      .update(runs)
      .set({ status: 'done', proposed: inserted.length, updatedAt: new Date() })
      .where(and(eq(runs.id, runId), eq(runs.userId, userId)));
  });
  deps.logger.info({ runId, proposed: fresh.length }, 'keywords proposed');
}
