import {
  type ContractKind,
  localDate,
  type RulePenalties,
  RULES_VERSION,
  type RulesOffer,
  type RuleWeights,
  scoreOffer,
  type ScoreProfile,
} from '@job4me/collect';
import type { Settings } from '@job4me/config';
import { and, eq, inArray, isNull, schema, sql, type Transaction } from '@job4me/db';
import type { ClaudeOffer } from '../ai/scoring';
import {
  type ClaudeContext,
  claudeContextOf,
  claudeOfferOf,
  claudeOfferVersion,
  isCurrentClaudeScore,
  versionOf,
} from './claude-context';

// The scoring without AI on the stored announcements (phase 3 plan, section 7; ADR 0018): the
// pure rules of packages/collect, the profile, the facts of each kept announcement. A score is
// computed again only when the profile, the offer or the rules change (their versions). A score
// by Claude still current (lot 5) is kept; one no longer current gives way to this one.

const CHUNK = 500;

export interface ScoringContext {
  profile: ScoreProfile;
  weights: RuleWeights;
  penalties: RulePenalties;
  /** The rules, their weights and the profile as scored: a change scores everything again. */
  profileVersion: string;
  /** What the scoring by Claude reads, to tell whether one of its scores is still current. */
  claude: ClaudeContext;
}

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
    profileVersion: versionOf({ rules: RULES_VERSION, weights, penalties, scoring }),
    claude: await claudeContextOf(tx, userId, settings, now),
  };
}

/** A kept announcement as both scorings read it, with its current score. */
export interface OfferFacts {
  id: string;
  firstSeenAt: Date;
  /** The sources of its postings, the retained one first. */
  sources: string[];
  rules: RulesOffer;
  /** Computed on first use: the redaction of the text is not free. */
  readonly claude: ClaudeOffer;
  readonly claudeVersion: string;
  current: {
    method: string;
    score: number;
    profileVersion: string;
    offerVersion: string;
  } | null;
}

/**
 * The kept announcements of an account and their facts: the ones given, every one (`null`), or
 * the ones without a score (`'unscored'`). The measure of the reference set reads the offers set
 * aside too (`kept: false`).
 */
export async function offerFactsOf(
  tx: Transaction,
  userId: string,
  which: readonly string[] | null | 'unscored',
  { kept = true }: { kept?: boolean } = {},
): Promise<OfferFacts[]> {
  if (Array.isArray(which) && which.length === 0) return [];
  const offers = schema.offers;
  const scores = schema.offerScores;
  const postings = schema.jobOffers;
  const rows = await tx
    .select({
      id: offers.id,
      retainedId: offers.retainedId,
      placeStatus: offers.placeStatus,
      placeName: offers.placeName,
      distanceKm: offers.distanceKm,
      remote: offers.remote,
      firstSeenAt: offers.firstSeenAt,
      method: scores.method,
      score: scores.score,
      profileVersion: scores.profileVersion,
      offerVersion: scores.offerVersion,
    })
    .from(offers)
    .leftJoin(scores, eq(scores.offerId, offers.id))
    .where(
      and(
        eq(offers.userId, userId),
        kept ? isNull(offers.excludedReason) : undefined,
        which === 'unscored'
          ? isNull(scores.id)
          : which === null
            ? undefined
            : inArray(offers.id, [...new Set(which)]),
      ),
    )
    .orderBy(offers.firstSeenAt, offers.id);
  const result: OfferFacts[] = [];
  for (let index = 0; index < rows.length; index += CHUNK) {
    const chunk = rows.slice(index, index + CHUNK);
    const facts = await tx
      .select({
        id: postings.id,
        offerId: postings.offerId,
        source: postings.source,
        title: postings.title,
        company: postings.company,
        location: postings.location,
        description: postings.description,
        details: postings.details,
        salary: postings.salary,
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
      )
      .orderBy(postings.firstSeenAt, postings.id);
    const byOffer = new Map<string, typeof facts>();
    for (const fact of facts) {
      const list = byOffer.get(fact.offerId);
      if (list) list.push(fact);
      else byOffer.set(fact.offerId, [fact]);
    }
    for (const row of chunk) {
      const list = byOffer.get(row.id) ?? [];
      const retained = list.find((fact) => fact.id === row.retainedId) ?? list[0];
      if (!retained) continue;
      const dates = list.flatMap((fact) => (fact.postedOn ? [fact.postedOn] : [])).sort();
      // The offer as Claude reads it, its contacts redacted: only when it is asked for (the
      // scoring without AI asks only for the offers that Claude scored).
      const claudeFacts = {
        title: retained.title,
        company: retained.company,
        location: retained.location,
        description: retained.description,
        details: retained.details,
        salary: retained.salary,
        placeStatus: row.placeStatus,
        placeName: row.placeName,
        distanceKm: row.distanceKm,
        remote: row.remote,
      };
      let claude: { offer: ClaudeOffer; version: string } | null = null;
      const claudeOf = () => {
        if (!claude) {
          const offer = claudeOfferOf(claudeFacts);
          claude = { offer, version: claudeOfferVersion(offer) };
        }
        return claude;
      };
      result.push({
        id: row.id,
        firstSeenAt: row.firstSeenAt,
        sources: [...new Set([retained.source, ...list.map((fact) => fact.source)])],
        rules: {
          title: retained.title,
          description: retained.description,
          details: retained.details,
          placeStatus: row.placeStatus as 'found' | 'unknown' | 'abroad' | null,
          distanceKm: row.distanceKm,
          remote: row.remote as 'full' | 'hybrid' | null,
          contracts: [...new Set(list.flatMap((fact) => fact.contracts))].sort() as ContractKind[],
          languages: [...new Set(list.flatMap((fact) => fact.languages))].sort(),
          postedOn: dates.at(-1) ?? localDate(row.firstSeenAt, 'Europe/Brussels'),
        },
        get claude() {
          return claudeOf().offer;
        },
        get claudeVersion() {
          return claudeOf().version;
        },
        current:
          row.method !== null &&
          row.score !== null &&
          row.profileVersion !== null &&
          row.offerVersion !== null
            ? {
                method: row.method,
                score: row.score,
                profileVersion: row.profileVersion,
                offerVersion: row.offerVersion,
              }
            : null,
      });
    }
  }
  return result;
}

/** The score without AI of an offer, and the version of what it was computed from. */
export function rulesScoreOf(facts: OfferFacts, context: ScoringContext) {
  return {
    offerVersion: versionOf(facts.rules),
    ...scoreOffer(facts.rules, context.profile, context.weights, context.penalties),
  };
}

/** The row of a score without AI. */
export function rulesRow(
  userId: string,
  facts: OfferFacts,
  context: ScoringContext,
  now: Date,
): typeof schema.offerScores.$inferInsert {
  const result = rulesScoreOf(facts, context);
  return {
    userId,
    offerId: facts.id,
    method: 'rules',
    score: result.score,
    // Without AI, a score never triggers an automatic sending (phase 5).
    confidence: 'low',
    factors: result.factors,
    reason: null,
    analysis: null,
    model: null,
    promptVersion: RULES_VERSION,
    profileVersion: context.profileVersion,
    offerVersion: result.offerVersion,
    scoredAt: now,
    updatedAt: now,
  };
}

/** Writes scores, one row per announcement: the newest replaces the one there. */
export async function writeScores(
  tx: Transaction,
  values: Array<typeof schema.offerScores.$inferInsert>,
): Promise<void> {
  if (values.length === 0) return;
  const scores = schema.offerScores;
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
        analysis: sql`excluded.analysis`,
        model: sql`excluded.model`,
        promptVersion: sql`excluded.prompt_version`,
        profileVersion: sql`excluded.profile_version`,
        offerVersion: sql`excluded.offer_version`,
        scoredAt: sql`excluded.scored_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
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
  const offers = await offerFactsOf(tx, userId, which);
  const values = [];
  for (const facts of offers) {
    const current = facts.current;
    // Only an offer Claude scored needs its version as Claude reads it.
    if (
      current &&
      current.method !== 'rules' &&
      isCurrentClaudeScore(current, context.claude, facts.claudeVersion)
    ) {
      continue;
    }
    if (
      current?.method === 'rules' &&
      current.profileVersion === context.profileVersion &&
      current.offerVersion === versionOf(facts.rules)
    ) {
      continue;
    }
    values.push(rulesRow(userId, facts, context, now));
  }
  for (let index = 0; index < values.length; index += CHUNK) {
    await writeScores(tx, values.slice(index, index + CHUNK));
  }
  return { scored: values.length };
}
