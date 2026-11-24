import { createHash } from 'node:crypto';
import { localDate } from '@job4me/collect';
import type { Settings } from '@job4me/config';
import type { ScoringWeights } from '@job4me/contracts';
import { asc, eq, schema, type Transaction } from '@job4me/db';
import {
  type ClaudeOffer,
  type ClaudeProfile,
  DETAILED_PROMPT_VERSION,
  inTurns,
  offerText,
  QUICK_PROMPT_VERSION,
  type RatedExample,
} from '../ai/scoring';

// What the scoring by Claude reads (phase 3 plan, sections 7 bis and 8; decision D2): the
// profile without identity, contacts or base city; for each offer, title, employer, place,
// distance and the start of its text without e-mail or phone number. Their versions decide when
// a score by Claude is still current: the scoring without AI gives way to it only then.

export interface ClaudeContext {
  profile: ClaudeProfile;
  instructions: string | null;
  /** Offers the candidate rated, as the calibration of severity (SPEC, section 5). */
  examples: RatedExample[];
  /** Their announcements: the measure of the reference set leaves them aside. */
  calibrationIds: string[];
  /** The grid of the detailed analysis: the profile's, else the configuration's. */
  weights: ScoringWeights;
  /** Prompts, models, settings and data sent: a change scores every offer again. */
  version: string;
}

export const versionOf = (value: unknown): string =>
  createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/** Whole months from a YYYY-MM to another (or to the current month), null without a start. */
function monthsBetween(start: string | null, end: string | null, today: string): number | null {
  if (!start) return null;
  const [startYear, startMonth] = start.split('-').map(Number);
  const [endYear, endMonth] = (end ?? today.slice(0, 7)).split('-').map(Number);
  if (!startYear || !startMonth || !endYear || !endMonth) return null;
  return Math.max(0, (endYear - startYear) * 12 + (endMonth - startMonth) + 1);
}

export async function claudeContextOf(
  tx: Transaction,
  userId: string,
  settings: Settings,
  now: Date,
): Promise<ClaudeContext> {
  const [profile] = await tx
    .select({
      motivations: schema.profiles.motivations,
      motivationTags: schema.profiles.motivationTags,
      radiusKm: schema.profiles.radiusKm,
      contracts: schema.profiles.contractTypes,
      regimes: schema.profiles.workRegimes,
      remote: schema.profiles.remotePreference,
      salaryMinMonthly: schema.profiles.salaryMinMonthly,
      instructions: schema.profiles.scoringInstructions,
      weights: schema.profiles.scoringWeights,
    })
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId));
  const targetJobs = await tx
    .select({ title: schema.targetJobs.title })
    .from(schema.targetJobs)
    .where(eq(schema.targetJobs.userId, userId))
    .orderBy(asc(schema.targetJobs.position), asc(schema.targetJobs.id));
  const skills = await tx
    .select({ name: schema.skills.name, level: schema.skills.level, years: schema.skills.years })
    .from(schema.skills)
    .where(eq(schema.skills.userId, userId))
    .orderBy(asc(schema.skills.createdAt), asc(schema.skills.id));
  const languages = await tx
    .select({ language: schema.languageLevels.language, level: schema.languageLevels.overall })
    .from(schema.languageLevels)
    .where(eq(schema.languageLevels.userId, userId))
    .orderBy(asc(schema.languageLevels.language));
  const experiences = await tx
    .select({
      title: schema.experiences.title,
      start: schema.experiences.startMonth,
      end: schema.experiences.endMonth,
      current: schema.experiences.current,
    })
    .from(schema.experiences)
    .where(eq(schema.experiences.userId, userId))
    .orderBy(asc(schema.experiences.startMonth), asc(schema.experiences.id));
  const degrees = await tx
    .select({ degree: schema.educations.degree })
    .from(schema.educations)
    .where(eq(schema.educations.userId, userId))
    .orderBy(asc(schema.educations.year), asc(schema.educations.id));
  const certifications = await tx
    .select({ name: schema.certifications.name })
    .from(schema.certifications)
    .where(eq(schema.certifications.userId, userId))
    .orderBy(asc(schema.certifications.year), asc(schema.certifications.id));
  const sectors = await tx
    .select({ sector: schema.sectorPreferences.sector, kind: schema.sectorPreferences.kind })
    .from(schema.sectorPreferences)
    .where(eq(schema.sectorPreferences.userId, userId))
    .orderBy(asc(schema.sectorPreferences.sector));
  const eliminations = await tx
    .select({ kind: schema.eliminationRules.kind, value: schema.eliminationRules.value })
    .from(schema.eliminationRules)
    .where(eq(schema.eliminationRules.userId, userId))
    .orderBy(asc(schema.eliminationRules.kind), asc(schema.eliminationRules.value));

  const today = localDate(now, settings.collect.schedule.timeZone);
  const sectorsOf = (kind: string) =>
    sectors.filter((row) => row.kind === kind).map((row) => row.sector);
  const claudeProfile: ClaudeProfile = {
    targetJobs: targetJobs.map((row) => row.title),
    skills: skills.map((row) => ({ name: row.name, level: row.level, years: row.years })),
    languages,
    // A position held today runs to this month; one ended without an end month has no duration.
    experiences: experiences.map((row) => ({
      title: row.title,
      months: row.current
        ? monthsBetween(row.start, null, today)
        : row.end
          ? monthsBetween(row.start, row.end, today)
          : null,
    })),
    degrees: degrees.map((row) => row.degree),
    certifications: certifications.map((row) => row.name),
    radiusKm: profile?.radiusKm ?? settings.profile.defaultRadiusKm,
    contracts: [...(profile?.contracts ?? [])].sort(),
    regimes: [...(profile?.regimes ?? [])].sort(),
    remote: profile?.remote ?? null,
    salaryMinMonthly: profile?.salaryMinMonthly ?? null,
    sectors: {
      preferred: sectorsOf('preferred'),
      accepted: sectorsOf('accepted'),
      excluded: sectorsOf('excluded'),
    },
    eliminations,
    motivations: profile?.motivations ?? null,
    motivationTags: profile?.motivationTags ?? [],
  };
  const stored = profile?.weights as ScoringWeights | null | undefined;
  const weights: ScoringWeights = stored ?? settings.scoring.defaultWeights;
  const instructions = profile?.instructions ?? null;
  // The calibration (SPEC, section 5): one rated offer per band first (80, 60, 40, 0), the oldest
  // ratings first, so that a new rating changes nothing once the calibration is full.
  const rated = await tx
    .select({
      offerId: schema.offerRatings.offerId,
      rating: schema.offerRatings.rating,
      note: schema.offerRatings.note,
      title: schema.jobOffers.title,
      company: schema.jobOffers.company,
      location: schema.jobOffers.location,
      placeStatus: schema.offers.placeStatus,
      placeName: schema.offers.placeName,
    })
    .from(schema.offerRatings)
    .innerJoin(schema.offers, eq(schema.offers.id, schema.offerRatings.offerId))
    .innerJoin(schema.jobOffers, eq(schema.jobOffers.id, schema.offers.retainedId))
    .where(eq(schema.offerRatings.userId, userId))
    .orderBy(asc(schema.offerRatings.createdAt), asc(schema.offerRatings.id));
  const band = (rating: number) => (rating >= 80 ? 0 : rating >= 60 ? 1 : rating >= 40 ? 2 : 3);
  const calibration = inTurns(
    [...rated].sort((a, b) => band(a.rating) - band(b.rating)),
    (row) => String(band(row.rating)),
  ).slice(0, settings.ai.scoring.quick.examples);
  const examples: RatedExample[] = calibration.map((row) => ({
    title: offerText(row.title),
    company: offerText(row.company) || '?',
    place:
      offerText(row.placeStatus === 'found' && row.placeName ? row.placeName : row.location) || '?',
    rating: row.rating,
    note: row.note ? offerText(row.note) : null,
  }));
  // What changes an answer; not how many offers a pass sends, nor the threshold of the analysis.
  const { quick, detailed } = settings.ai.scoring;
  return {
    profile: claudeProfile,
    instructions,
    examples,
    calibrationIds: calibration.map((row) => row.offerId),
    weights,
    version: versionOf({
      prompts: [QUICK_PROMPT_VERSION, DETAILED_PROMPT_VERSION],
      quick: [quick.model, quick.effort, quick.descriptionChars, quick.reasonChars],
      detailed: [
        detailed.model,
        detailed.effort,
        detailed.fallbacks,
        detailed.descriptionChars,
        detailed.blockerCap,
        detailed.maxFindings,
        detailed.findingChars,
      ],
      // The experiences as stored: a month more in a current position scores nothing again.
      profile: { ...claudeProfile, experiences },
      instructions,
      examples,
      weights,
    }),
  };
}

/** The facts of an announcement that its offer for Claude is drawn from. */
export interface ClaudeFacts {
  title: string;
  company: string;
  location: string;
  description: string;
  details: string | null;
  salary: string | null;
  placeStatus: string | null;
  placeName: string | null;
  distanceKm: number | null;
  remote: string | null;
}

/** The offer as Claude reads it: its own words, the recruiter's contacts removed. */
export function claudeOfferOf(facts: ClaudeFacts): ClaudeOffer {
  const where =
    facts.placeStatus === 'found' && facts.placeName ? facts.placeName : facts.location || '?';
  const distance =
    facts.distanceKm !== null
      ? `${facts.distanceKm} km`
      : facts.placeStatus === 'abroad'
        ? 'à l’étranger'
        : 'distance inconnue';
  const remote =
    facts.remote === 'full'
      ? ' · télétravail complet'
      : facts.remote === 'hybrid'
        ? ' · télétravail partiel'
        : '';
  const conditions = [facts.details, facts.salary]
    .map((part) => offerText(part))
    .filter((part) => part !== '')
    .join(' · ');
  return {
    title: offerText(facts.title),
    company: offerText(facts.company) || '?',
    place: `${offerText(where) || '?'} [${distance}]${remote}`,
    conditions: conditions === '' ? null : conditions,
    description: offerText(facts.description),
  };
}

/** The version of an offer as sent: a change of what Claude would read scores it again. */
export const claudeOfferVersion = (offer: ClaudeOffer): string => versionOf(offer);

/** A Claude score is current when neither the context nor the offer has changed since. */
export function isCurrentClaudeScore(
  row: { method: string | null; profileVersion: string | null; offerVersion: string | null },
  context: Pick<ClaudeContext, 'version'>,
  offerVersion: string,
): boolean {
  return (
    (row.method === 'claude_quick' || row.method === 'claude_detailed') &&
    row.profileVersion === context.version &&
    row.offerVersion === offerVersion
  );
}
