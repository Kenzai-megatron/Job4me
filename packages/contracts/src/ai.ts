import { z } from 'zod';
import { importRunSchema } from './imports';
import { cefrLevels, keywordLanguages, skillLevels } from './profile';

// Claude API (phase 1 plan, section 5; ADR 0009). Schemas of what the model must return, and of
// what the interface shows about the calls (never their content).

export const aiUsages = [
  'cv_structuring',
  'keywords',
  // Phase 3 (plan, sections 7 bis and 8): off until the setting switches them on (decision D5).
  'scoring_quick',
  'scoring_detailed',
] as const;
export type AiUsage = (typeof aiUsages)[number];

/** How a call ended; `blocked` and `disabled` mean that no request was sent. */
export const aiCallStatuses = [
  'succeeded',
  'refused',
  'invalid_output',
  'failed',
  'blocked',
  'disabled',
] as const;
export type AiCallStatus = (typeof aiCallStatuses)[number];

/** Why an AI step gave nothing; the interface translates them. */
export const aiErrorCodes = [
  'ai_disabled',
  'ai_cap_reached',
  'ai_refused',
  'ai_invalid_output',
  'ai_failed',
] as const;
export type AiErrorCode = (typeof aiErrorCodes)[number];

/** A short excerpt copied word for word from the CV: a proposal without one is dropped. */
const evidence = z
  .string()
  .describe('Extrait du CV, recopié mot pour mot, qui justifie cette proposition');
const month = z
  .string()
  .nullable()
  .describe('Mois au format AAAA-MM, ou null si le CV ne le donne pas');

/** What Claude Haiku returns for a CV: proposals only, each with its evidence. */
export const cvStructuringSchema = z.object({
  targetJobs: z
    .array(z.object({ title: z.string(), evidence }))
    .describe('Intitulés de poste que le CV annonce comme objectif, s’il y en a'),
  experiences: z.array(
    z.object({
      title: z.string(),
      employer: z.string(),
      location: z.string().nullable(),
      startMonth: month,
      endMonth: month,
      current: z.boolean(),
      evidence,
      achievements: z
        .array(z.object({ text: z.string(), evidence }))
        .describe('Réalisations de ce poste, une par élément, avec les chiffres du CV'),
    }),
  ),
  education: z.array(
    z.object({
      degree: z.string(),
      institution: z.string().nullable(),
      year: z.number().int().nullable(),
      evidence,
    }),
  ),
  certifications: z.array(
    z.object({
      name: z.string(),
      issuer: z.string().nullable(),
      year: z.number().int().nullable(),
      evidence,
    }),
  ),
  skills: z.array(z.object({ name: z.string(), level: z.enum(skillLevels).nullable(), evidence })),
  languages: z.array(
    z.object({
      language: z.string().describe('Code ISO 639-1 en minuscules : fr, nl, en, de…'),
      level: z.enum(cefrLevels).nullable(),
      evidence,
    }),
  ),
});
export type CvStructuring = z.infer<typeof cvStructuringSchema>;

/** What Claude Sonnet returns when asked for search keywords. */
export const keywordProposalSchema = z.object({
  keywords: z.array(
    z.object({
      keyword: z.string(),
      language: z.enum(keywordLanguages),
      priority: z.boolean(),
    }),
  ),
});
export type KeywordProposal = z.infer<typeof keywordProposalSchema>;

/** The identifier of the n-th offer of a scoring batch, as the prompt gives it: o1, o2… */
export const batchOfferId = (index: number): string => `o${index + 1}`;

/**
 * What Claude Haiku returns for a batch of offers (phase 3 plan, section 7 bis): one score and
 * one reason per offer. The identifiers are those of a full batch, whatever its size, so that
 * one schema serves every batch; the worker checks that each offer sent comes back once.
 */
export function quickScoringSchema(batchSize: number) {
  const ids = Array.from({ length: batchSize }, (_, index) => batchOfferId(index));
  return z.strictObject({
    scores: z.array(
      z.strictObject({
        id: z
          .enum(ids as [string, ...string[]])
          .describe("Identifiant de l'offre, recopié tel quel"),
        score: z.number().int().min(0).max(100).describe('Score sur 100, selon le barème'),
        reason: z
          .string()
          .describe('Ce qui a décidé du score, en une phrase de 200 caractères au plus'),
      }),
    ),
  });
}
export type QuickScoring = z.infer<ReturnType<typeof quickScoringSchema>>;

const subscore = (what: string) => z.number().int().min(0).max(100).describe(`${what}, sur 100`);
const findings = (what: string) => z.array(z.string()).describe(what);

/** What Claude Sonnet returns for one offer of 70 or more (phase 3 plan, section 8). */
export const detailedScoringSchema = z.strictObject({
  subscores: z.strictObject({
    skills: subscore(
      'Compétences techniques : compétences demandées et déclarées, et leurs niveaux',
    ),
    experience: subscore('Expérience et fonction : intitulé, séniorité, années, responsabilités'),
    languages: subscore('Langues : niveaux exigés par rapport aux niveaux déclarés'),
    practical: subscore('Critères pratiques : distance, contrat, régime, télétravail, salaire'),
    sector: subscore('Secteur : préféré, accepté ou exclu'),
    motivations: subscore('Motivations : adéquation avec ce que le candidat cherche'),
  }),
  strengths: findings('Points forts du profil pour cette offre, une phrase courte chacun'),
  gaps: findings("Écarts entre l'offre et le profil, une phrase courte chacun"),
  blockers: findings(
    "Éléments bloquants : exigences explicites de l'offre que le profil ne remplit manifestement pas",
  ),
  keywords: findings("Mots-clés de l'offre à reprendre dans le CV et la lettre"),
  reason: z.string().describe('Ce qui décide du score, en une phrase de 200 caractères au plus'),
});
export type DetailedScoring = z.infer<typeof detailedScoringSchema>;

/** Where an import proposal goes once accepted; Mehdi reviews them one by one. */
export const proposalRubrics = [
  'identity',
  'target-jobs',
  'experiences',
  'facts',
  'education',
  'certifications',
  'skills',
  'languages',
  // LinkedIn history, kept for phases 3 and 5: accepted as a whole.
  'saved-offers',
  'past-applications',
] as const;
export type ProposalRubric = (typeof proposalRubrics)[number];
export const proposalSources = ['local', 'ai', 'linkedin'] as const;
export const proposalDecisions = ['pending', 'accepted', 'corrected', 'ignored'] as const;

/** A proposal as the review screen shows it: its content, its evidence, a possible duplicate. */
export const proposalSchema = z.object({
  id: z.uuid(),
  rubric: z.enum(proposalRubrics),
  source: z.enum(proposalSources),
  decision: z.enum(proposalDecisions),
  content: z.record(z.string(), z.unknown()),
  /** Close to an entry already in the profile. */
  duplicate: z.boolean(),
});
export type Proposal = z.infer<typeof proposalSchema>;

export const importReviewSchema = z.object({
  run: importRunSchema,
  proposals: z.array(proposalSchema),
});
export type ImportReview = z.infer<typeof importReviewSchema>;

/** Accept as proposed, accept corrected (content given), or set aside. */
export const proposalDecisionSchema = z.object({
  decision: z.enum(['accept', 'ignore']),
  content: z.record(z.string(), z.unknown()).optional(),
});

/** One LinkedIn history row (saved offer or past application). */
export const historyRowSchema = z.object({
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().max(300).nullable(),
  url: z.string().trim().max(2000).nullable(),
  date: z.iso.date().nullable(),
});
export type HistoryRow = z.infer<typeof historyRowSchema>;

export const keywordRunStatuses = ['queued', 'running', 'done', 'failed'] as const;
export const keywordRunSchema = z.object({
  id: z.uuid(),
  status: z.enum(keywordRunStatuses),
  errorCode: z.enum(aiErrorCodes).nullable(),
  proposed: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KeywordRun = z.infer<typeof keywordRunSchema>;
export const latestKeywordRunSchema = z.object({ run: keywordRunSchema.nullable() });

export const aiCallSchema = z.object({
  id: z.uuid(),
  usage: z.enum(aiUsages),
  model: z.string(),
  status: z.enum(aiCallStatuses),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0),
  costUsd: z.number().min(0),
  createdAt: z.string(),
});

/** What one usage has cost (phase 3 plan, section 10: quick scoring, detailed analysis…). */
export const aiUsageSpendSchema = z.object({
  usage: z.enum(aiUsages),
  weekUsd: z.number().min(0),
  totalUsd: z.number().min(0),
  /** Requests sent (not those a cap or a missing key held back). */
  calls: z.number().int().min(0),
});
export type AiUsageSpend = z.infer<typeof aiUsageSpendSchema>;

export const aiUsageResponseSchema = z.object({
  weekUsd: z.number().min(0),
  totalUsd: z.number().min(0),
  caps: z.object({ weeklyUsd: z.number(), totalUsd: z.number() }),
  /** Each usage that has a call, in the order of `aiUsages`. */
  byUsage: z.array(aiUsageSpendSchema),
  calls: z.array(aiCallSchema),
});
export type AiUsageResponse = z.infer<typeof aiUsageResponseSchema>;
