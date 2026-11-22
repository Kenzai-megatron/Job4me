import type { Settings } from '@job4me/config';
import {
  certificationInputSchema,
  educationInputSchema,
  eliminationInputSchema,
  excludedCompanyInputSchema,
  experienceInputSchema,
  factInputSchema,
  factItemSchema,
  keywordInputSchema,
  keywordItemSchema,
  languageInputSchema,
  type ProfileRubric,
  rubricItemSchema,
  sectorInputSchema,
  skillInputSchema,
  targetJobInputSchema,
  titleFilterInputSchema,
} from '@job4me/contracts';
import { and, eq, schema, type Transaction } from '@job4me/db';
import type { z } from 'zod';

/** What the generic list routes need from a profile table. */
export interface RubricTable {
  id: (typeof schema.skills)['id'];
  userId: (typeof schema.skills)['userId'];
  createdAt: (typeof schema.skills)['createdAt'];
  updatedAt: (typeof schema.skills)['updatedAt'];
}

export interface RubricDefinition {
  slug: ProfileRubric;
  table: (typeof schema)[RubricTableName];
  input: z.ZodObject;
  item: z.ZodObject;
  /** Values the server sets on creation, never the client. */
  serverValues?: Record<string, unknown>;
  /** Maximum entries per account, from the configuration. */
  limit?: (settings: Settings) => number;
  /** Extra checks before writing, inside the user's transaction; false refuses the body. */
  accepts?: (tx: Transaction, userId: string, body: Record<string, unknown>) => Promise<boolean>;
}

type RubricTableName =
  | 'targetJobs'
  | 'searchKeywords'
  | 'sectorPreferences'
  | 'skills'
  | 'languageLevels'
  | 'experiences'
  | 'facts'
  | 'educations'
  | 'certifications'
  | 'eliminationRules'
  | 'titleFilterRules'
  | 'excludedCompanies';

/** A fact may point to one of the user's own experiences only (foreign keys ignore RLS). */
async function ownExperience(tx: Transaction, userId: string, body: Record<string, unknown>) {
  const experienceId = body.experienceId;
  if (experienceId === null || experienceId === undefined) return true;
  if (typeof experienceId !== 'string') return false;
  const rows = await tx
    .select({ id: schema.experiences.id })
    .from(schema.experiences)
    .where(and(eq(schema.experiences.id, experienceId), eq(schema.experiences.userId, userId)));
  return rows.length === 1;
}

export const rubricDefinitions: RubricDefinition[] = [
  {
    slug: 'target-jobs',
    table: schema.targetJobs,
    input: targetJobInputSchema,
    item: rubricItemSchema(targetJobInputSchema),
    limit: (settings) => settings.profile.maxTargetJobs,
  },
  {
    slug: 'keywords',
    table: schema.searchKeywords,
    input: keywordInputSchema,
    item: keywordItemSchema,
    serverValues: { origin: 'manual' },
    limit: (settings) => settings.profile.keywords.max * 3,
  },
  {
    slug: 'sectors',
    table: schema.sectorPreferences,
    input: sectorInputSchema,
    item: rubricItemSchema(sectorInputSchema),
  },
  {
    slug: 'skills',
    table: schema.skills,
    input: skillInputSchema,
    item: rubricItemSchema(skillInputSchema),
  },
  {
    slug: 'languages',
    table: schema.languageLevels,
    input: languageInputSchema,
    item: rubricItemSchema(languageInputSchema),
  },
  {
    slug: 'experiences',
    table: schema.experiences,
    input: experienceInputSchema,
    item: rubricItemSchema(experienceInputSchema),
  },
  {
    slug: 'facts',
    table: schema.facts,
    input: factInputSchema,
    item: factItemSchema,
    serverValues: { origin: 'manual' },
    accepts: ownExperience,
  },
  {
    slug: 'education',
    table: schema.educations,
    input: educationInputSchema,
    item: rubricItemSchema(educationInputSchema),
  },
  {
    slug: 'certifications',
    table: schema.certifications,
    input: certificationInputSchema,
    item: rubricItemSchema(certificationInputSchema),
  },
  {
    slug: 'eliminations',
    table: schema.eliminationRules,
    input: eliminationInputSchema,
    item: rubricItemSchema(eliminationInputSchema),
  },
  {
    slug: 'title-filters',
    table: schema.titleFilterRules,
    input: titleFilterInputSchema,
    item: rubricItemSchema(titleFilterInputSchema),
  },
  {
    slug: 'excluded-companies',
    table: schema.excludedCompanies,
    input: excludedCompanyInputSchema,
    item: rubricItemSchema(excludedCompanyInputSchema),
  },
];
