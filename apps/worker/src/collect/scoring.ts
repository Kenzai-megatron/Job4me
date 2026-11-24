import { createHash } from 'node:crypto';
import {
  type ContractKind,
  localDate,
  type RulePenalties,
  RULES_VERSION,
  type RuleWeights,
  scoreOffer,
  type ScoreProfile,
} from '@job4me/collect';
import type { Settings } from '@job4me/config';
import { and, eq, inArray, isNull, schema, sql, type Transaction } from '@job4me/db';

// The scoring without AI on the stored announcements (phase 3 plan, section 7; ADR 0018): the
// pure rules of packages/collect, the profile, the facts of each kept announcement. A score is
// computed again only when the profile, the offer or the rules change (their versions).

const CHUNK = 500;

export interface ScoringContext {
  profile: ScoreProfile;
  weights: RuleWeights;
  penalties: RulePenalties;
  /** The rules, their weights and the profile as scored: a change scores everything again. */
  profileVersion: string;
}

const version = (value: unknown) =>
  createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/** What the scoring reads of an account's profile. */
export async function scoringContextOf(
  tx: Transaction,
  userId: string,
  settings: Settings,
  now: Date,
): Promise<ScoringContext> {
  const [profile] = await tx
    .select({
      radiusKm: schema.profiles.radiusKm,
      remote: schema.profiles.remotePreference,
      contracts: schema.profiles.contractTypes,
      regimes: schema.profiles.workRegimes,
    })
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId));
  const targetJobs = await tx
    .select({ title: schema.targetJobs.title })
    .from(schema.targetJobs)
    .where(eq(schema.targetJobs.userId, userId))
    .orderBy(schema.targetJobs.position);
  const keywords = await tx
    .select({ keyword: schema.searchKeywords.keyword, priority: schema.searchKeywords.priority })
    .from(schema.searchKeywords)
    .where(
      and(eq(schema.searchKeywords.userId, userId), eq(schema.searchKeywords.status, 'validated')),
    )
    .orderBy(schema.searchKeywords.createdAt, schema.searchKeywords.id);
  const skills = await tx
    .select({ name: schema.skills.name })
    .from(schema.skills)
    .where(eq(schema.skills.userId, userId))
    .orderBy(schema.skills.createdAt, schema.skills.id);
  const languages = await tx
    .select({ language: schema.languageLevels.language, overall: schema.languageLevels.overall })
    .from(schema.languageLevels)
    .where(eq(schema.languageLevels.userId, userId));
  const sectors = await tx
    .select({ sector: schema.sectorPreferences.sector })
    .from(schema.sectorPreferences)
    .where(
      and(
        eq(schema.sectorPreferences.userId, userId),
        eq(schema.sectorPreferences.kind, 'excluded'),
      ),
    );
  const rejected = await tx
    .select({ expression: schema.titleFilterRules.expression })
    .from(schema.titleFilterRules)
    .where(
      and(eq(schema.titleFilterRules.userId, userId), eq(schema.titleFilterRules.list, 'reject')),
    );
  const scoring: Omit<ScoreProfile, 'today'> = {
    targetJobs: targetJobs.map((row) => row.title),
    keywords,
    skills: skills.map((row) => row.name),
    languages: Object.fromEntries(languages.map((row) => [row.language, row.overall])),
    contracts: (profile?.contracts ?? []) as ContractKind[],
    regimes: (profile?.regimes ?? []) as Array<'full_time' | 'part_time'>,
    radiusKm: profile?.radiusKm ?? settings.profile.defaultRadiusKm,
    acceptsRemote: profile?.remote !== 'on_site',
    excludedSectors: sectors.map((row) => row.sector),
    rejectExpressions: rejected.map((row) => row.expression).sort(),
  };
  const { weights, penalties } = settings.scoring.rules;
  return {
    profile: { ...scoring, today: localDate(now, settings.collect.schedule.timeZone) },
    weights,
    penalties,
    profileVersion: version({ rules: RULES_VERSION, weights, penalties, scoring }),
  };
}

/**
 * Scores the kept announcements of an account: the ones given, every one (`null`), or the ones
 * without a score (`'unscored'`). Returns how many scores were written.
 */
export async function scoreOffers(
  tx: Transaction,
  userId: string,
  which: readonly string[] | null | 'unscored',
  context: ScoringContext,
  now: Date,
): Promise<{ scored: number }> {
  if (Array.isArray(which) && which.length === 0) return { scored: 0 };
  const offers = schema.offers;
  const scores = schema.offerScores;
  const postings = schema.jobOffers;
  const rows = await tx
    .select({
      id: offers.id,
      retainedId: offers.retainedId,
      placeStatus: offers.placeStatus,
      distanceKm: offers.distanceKm,
      remote: offers.remote,
      firstSeenAt: offers.firstSeenAt,
      profileVersion: scores.profileVersion,
      offerVersion: scores.offerVersion,
    })
    .from(offers)
    .leftJoin(scores, eq(scores.offerId, offers.id))
    .where(
      and(
        eq(offers.userId, userId),
        isNull(offers.excludedReason),
        which === 'unscored'
          ? isNull(scores.id)
          : which === null
            ? undefined
            : inArray(offers.id, [...new Set(which)]),
      ),
    );
  let scored = 0;
  for (let index = 0; index < rows.length; index += CHUNK) {
    const chunk = rows.slice(index, index + CHUNK);
    const facts = await tx
      .select({
        id: postings.id,
        offerId: postings.offerId,
        title: postings.title,
        description: postings.description,
        details: postings.details,
        postedOn: postings.postedOn,
        contracts: postings.contracts,
        languages: postings.languages,
      })
      .from(postings)
      .where(
        and(
          eq(postings.userId, userId),
          inArray(
            postings.offerId,
            chunk.map((row) => row.id),
          ),
        ),
      );
    const byOffer = new Map<string, typeof facts>();
    for (const fact of facts) {
      const list = byOffer.get(fact.offerId);
      if (list) list.push(fact);
      else byOffer.set(fact.offerId, [fact]);
    }
    const values = [];
    for (const row of chunk) {
      const list = byOffer.get(row.id) ?? [];
      const retained = list.find((fact) => fact.id === row.retainedId) ?? list[0];
      if (!retained) continue;
      const dates = list.flatMap((fact) => (fact.postedOn ? [fact.postedOn] : [])).sort();
      const offer = {
        title: retained.title,
        description: retained.description,
        details: retained.details,
        placeStatus: row.placeStatus as 'found' | 'unknown' | 'abroad' | null,
        distanceKm: row.distanceKm,
        remote: row.remote as 'full' | 'hybrid' | null,
        contracts: [...new Set(list.flatMap((fact) => fact.contracts))].sort() as ContractKind[],
        languages: [...new Set(list.flatMap((fact) => fact.languages))].sort(),
        postedOn: dates.at(-1) ?? localDate(row.firstSeenAt, 'Europe/Brussels'),
      };
      const offerVersion = version(offer);
      if (row.profileVersion === context.profileVersion && row.offerVersion === offerVersion) {
        continue;
      }
      const result = scoreOffer(offer, context.profile, context.weights, context.penalties);
      values.push({
        userId,
        offerId: row.id,
        method: 'rules',
        score: result.score,
        // Without AI, a score never triggers an automatic sending (phase 5).
        confidence: 'low',
        factors: result.factors,
        reason: null,
        model: null,
        promptVersion: RULES_VERSION,
        profileVersion: context.profileVersion,
        offerVersion,
        scoredAt: now,
        updatedAt: now,
      });
    }
    if (values.length === 0) continue;
    await tx
      .insert(scores)
      .values(values)
      .onConflictDoUpdate({
        target: scores.offerId,
        set: {
          method: sql`excluded.method`,
          score: sql`excluded.score`,
          confidence: sql`excluded.confidence`,
          factors: sql`excluded.factors`,
          reason: sql`excluded.reason`,
          model: sql`excluded.model`,
          promptVersion: sql`excluded.prompt_version`,
          profileVersion: sql`excluded.profile_version`,
          offerVersion: sql`excluded.offer_version`,
          scoredAt: sql`excluded.scored_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    scored += values.length;
  }
  return { scored };
}
