import { z } from 'zod';

// Profile contracts (SPEC section 4, phase 1 plan section 3). Months travel as YYYY-MM,
// days as YYYY-MM-DD; an absent optional value is null.

export const keywordLanguages = ['fr', 'nl', 'en'] as const;
export const cefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export const skillLevels = ['beginner', 'intermediate', 'advanced', 'expert'] as const;
export const contractTypes = [
  'permanent',
  'fixed_term',
  'interim',
  'freelance',
  'internship',
  'student_job',
] as const;
export const workRegimes = ['full_time', 'part_time'] as const;
export const remotePreferences = ['on_site', 'hybrid', 'remote'] as const;
export const sectorKinds = ['preferred', 'accepted', 'excluded'] as const;
export const eliminationKinds = ['language', 'sector', 'schedule', 'travel', 'other'] as const;
export const titleFilterLists = ['keep', 'reject', 'always'] as const;
export const keywordStatuses = ['proposed', 'validated', 'rejected'] as const;
export const keywordOrigins = ['ai', 'manual', 'import'] as const;
export const factOrigins = ['manual', 'cv_import', 'linkedin_import'] as const;
export const transportModes = ['car', 'motorbike', 'public_transport', 'bike', 'walk'] as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().default(null);
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const yearSchema = z.number().int().min(1950).max(2100);
const idSchema = z.uuid();

export const profileIdParamsSchema = z.object({ id: idSchema });

/**
 * The grid of the detailed analysis (SPEC, section 5), weights changed by the candidate:
 * technical skills, experience and position, languages, practical criteria, sector, motivations.
 */
export const scoringCriteria = [
  'skills',
  'experience',
  'languages',
  'practical',
  'sector',
  'motivations',
] as const;
export type ScoringCriterion = (typeof scoringCriteria)[number];
export const scoringWeightsSchema = z
  .object(
    Object.fromEntries(scoringCriteria.map((name) => [name, z.number().int().min(0).max(100)])) as {
      [K in ScoringCriterion]: z.ZodNumber;
    },
  )
  .refine((weights) => Object.values(weights).reduce((sum, value) => sum + value, 0) === 100, {
    message: 'weights_total',
  });
export type ScoringWeights = z.infer<typeof scoringWeightsSchema>;

/** Practical criteria and motivations: one document per account. */
export const profileSchema = z.object({
  motivations: z.string().trim().max(4000).nullable(),
  motivationTags: z.array(text(40)).max(20),
  baseCity: z.string().trim().max(120).nullable(),
  basePostalCode: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  radiusKm: z.number().int().min(1).max(300).nullable(),
  contractTypes: z.array(z.enum(contractTypes)).max(contractTypes.length),
  workRegimes: z.array(z.enum(workRegimes)).max(workRegimes.length),
  remotePreference: z.enum(remotePreferences).nullable(),
  salaryMinMonthly: z.number().int().min(0).max(100_000).nullable(),
  availableFrom: z.iso.date().nullable(),
  /** What is off topic, the borderline cases: read by the scoring (phase 3 plan, section 3). */
  scoringInstructions: z.string().trim().max(2000).nullable(),
  /** The grid's weights, 100 in all; null: those of the configuration. */
  scoringWeights: scoringWeightsSchema.nullable(),
});
export const profilePatchSchema = profileSchema.partial();
export type ProfileDocument = z.infer<typeof profileSchema>;

/**
 * The base city read in the Belgian localities (ADR 0017): found (« Bruxelles, 1000 »), unknown,
 * abroad, or missing from the profile. Distances are measured from it.
 */
export const baseLocationStatuses = ['found', 'unknown', 'abroad', 'missing'] as const;
export const baseLocationSchema = z.object({
  status: z.enum(baseLocationStatuses),
  name: z.string().nullable(),
  postalCode: z.string().nullable(),
});
export type BaseLocation = z.infer<typeof baseLocationSchema>;

/** The profile document as the API returns it. */
export const profileResponseSchema = profileSchema.extend({
  defaultRadiusKm: z.number().int(),
  defaultScoringWeights: scoringWeightsSchema,
  baseLocation: baseLocationSchema,
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

/** Identity and contact details: encrypted at rest, never sent to the AI. */
export const identitySchema = z.object({
  fullName: z.string().trim().max(120).nullable(),
  email: z.email().max(254).nullable(),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9 ().-]{6,32}$/)
    .nullable(),
  commune: z.string().trim().max(120).nullable(),
  drivingLicences: z.array(z.string().regex(/^[A-Z0-9+]{1,4}$/)).max(10),
  transport: z.array(z.enum(transportModes)).max(transportModes.length),
});
export type Identity = z.infer<typeof identitySchema>;

// List rubrics: the body to create one entry, then the entry as the API returns it.
export const targetJobInputSchema = z.object({ title: text(120) });
export const keywordInputSchema = z.object({
  keyword: text(80),
  language: z.enum(keywordLanguages),
  priority: z.boolean().default(false),
  status: z.enum(keywordStatuses).default('validated'),
});
export const sectorInputSchema = z.object({ sector: text(120), kind: z.enum(sectorKinds) });
export const skillInputSchema = z.object({
  name: text(80),
  level: z.enum(skillLevels).nullable().default(null),
  years: z.number().min(0).max(60).multipleOf(0.5).nullable().default(null),
});
export const languageInputSchema = z.object({
  language: z.string().regex(/^[a-z]{2}$/),
  overall: z.enum(cefrLevels),
  understanding: z.enum(cefrLevels).nullable().default(null),
  speaking: z.enum(cefrLevels).nullable().default(null),
  writing: z.enum(cefrLevels).nullable().default(null),
});
export const experienceInputSchema = z.object({
  title: text(160),
  employer: text(160),
  location: optionalText(160),
  startMonth: monthSchema.nullable().default(null),
  endMonth: monthSchema.nullable().default(null),
  current: z.boolean().default(false),
  description: optionalText(4000),
});
export const factInputSchema = z.object({
  text: text(1000),
  experienceId: idSchema.nullable().default(null),
});
export const educationInputSchema = z.object({
  degree: text(200),
  institution: text(200),
  year: yearSchema.nullable().default(null),
});
export const certificationInputSchema = z.object({
  name: text(200),
  issuer: optionalText(200),
  year: yearSchema.nullable().default(null),
});
export const eliminationInputSchema = z.object({
  kind: z.enum(eliminationKinds),
  value: text(200),
});
export const titleFilterInputSchema = z.object({
  list: z.enum(titleFilterLists),
  expression: text(120),
});
export const excludedCompanyInputSchema = z.object({ name: text(200), reason: optionalText(500) });

/** The list rubrics, by the path segment of their routes (/api/profile/<slug>). */
export const profileRubrics = {
  'target-jobs': targetJobInputSchema,
  keywords: keywordInputSchema,
  sectors: sectorInputSchema,
  skills: skillInputSchema,
  languages: languageInputSchema,
  experiences: experienceInputSchema,
  facts: factInputSchema,
  education: educationInputSchema,
  certifications: certificationInputSchema,
  eliminations: eliminationInputSchema,
  'title-filters': titleFilterInputSchema,
  'excluded-companies': excludedCompanyInputSchema,
} as const;
export type ProfileRubric = keyof typeof profileRubrics;
export const profileRubricSlugs = Object.keys(profileRubrics) as ProfileRubric[];

/**
 * The body to change an entry: every field optional and none defaulted, so a field left out
 * keeps its value (Zod's partial() would still apply the defaults of the input schema).
 */
export function rubricPatchSchema(input: z.ZodObject) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries<z.ZodType>(input.shape)) {
    const inner = field instanceof z.ZodDefault ? (field.unwrap() as z.ZodType) : field;
    shape[key] = inner.optional();
  }
  return z.object(shape);
}

/** An entry as returned by the API: its input fields plus its id (and fixed extras). */
export function rubricItemSchema<T extends z.ZodObject>(input: T) {
  return input.extend({ id: idSchema });
}

export const keywordItemSchema = rubricItemSchema(keywordInputSchema).extend({
  origin: z.enum(keywordOrigins),
});
export const factItemSchema = rubricItemSchema(factInputSchema).extend({
  origin: z.enum(factOrigins),
});

export const completenessRubrics = [
  'identity',
  'practical',
  'motivations',
  'targetJobs',
  'keywords',
  'experiences',
  'facts',
  'skills',
  'languages',
  'education',
] as const;
export type CompletenessRubric = (typeof completenessRubrics)[number];

export const completenessSchema = z.object({
  percent: z.number().int().min(0).max(100),
  rubrics: z.array(
    z.object({
      rubric: z.enum(completenessRubrics),
      weight: z.number().int(),
      count: z.number().int(),
      min: z.number().int(),
      done: z.boolean(),
    }),
  ),
});
export type Completeness = z.infer<typeof completenessSchema>;
