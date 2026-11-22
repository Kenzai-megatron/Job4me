import { z } from 'zod';
import { cefrLevels, keywordLanguages, skillLevels } from './profile';

// Claude API (phase 1 plan, section 5; ADR 0009). Schemas of what the model must return, and of
// what the interface shows about the calls (never their content).

export const aiUsages = ['cv_structuring', 'keywords'] as const;
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

/** Where an import proposal goes once accepted (lot 5 reviews them one by one). */
export const proposalRubrics = [
  'identity',
  'target-jobs',
  'experiences',
  'facts',
  'education',
  'certifications',
  'skills',
  'languages',
] as const;
export type ProposalRubric = (typeof proposalRubrics)[number];
export const proposalSources = ['local', 'ai', 'linkedin'] as const;

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

export const aiUsageResponseSchema = z.object({
  weekUsd: z.number().min(0),
  totalUsd: z.number().min(0),
  caps: z.object({ weeklyUsd: z.number(), totalUsd: z.number() }),
  calls: z.array(aiCallSchema),
});
export type AiUsageResponse = z.infer<typeof aiUsageResponseSchema>;
