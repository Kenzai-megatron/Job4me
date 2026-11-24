import { z } from 'zod';

// Application documents (phase 4 plan, sections 3 to 7; ADR 0020 and 0021). One JSON per version
// of a document, the only source of its PDF and DOCX; every line keeps the facts of the profile
// it comes from, and how it was written.

export const documentKinds = ['cv', 'letter', 'mail'] as const;
export type DocumentKind = (typeof documentKinds)[number];
export const documentLanguages = ['fr', 'nl', 'en'] as const;
export type DocumentLanguage = (typeof documentLanguages)[number];
export const documentTemplates = ['classic', 'modern'] as const;
export type DocumentTemplate = (typeof documentTemplates)[number];

/** How a line was written: taken from the profile, by a template, by Claude, or by hand. */
export const lineOrigins = ['profile', 'template', 'claude', 'manual'] as const;
export type LineOrigin = (typeof lineOrigins)[number];

/** The element of the profile a line comes from (the offer only names the employer and job). */
export const sourceKinds = [
  'fact',
  'experience',
  'skill',
  'language',
  'education',
  'certification',
  'target_job',
  'motivations',
  'practical',
  'offer',
] as const;
export type SourceKind = (typeof sourceKinds)[number];
export const lineSourceSchema = z.object({
  kind: z.enum(sourceKinds),
  /** Null for the elements without an identifier of their own (motivations, criteria, offer). */
  id: z.uuid().nullable(),
});
export type LineSource = z.infer<typeof lineSourceSchema>;

/** Why the anti-invention check blocks a line (ADR 0021); the interface words them. */
export const lineBlocks = ['no_source', 'unknown_source', 'number', 'name', 'review'] as const;
export const lineCheckSchema = z.object({
  status: z.enum(['ok', 'blocked']),
  reason: z.enum(lineBlocks).nullable(),
  /** What was not found in the facts: a figure, a name. */
  detail: z.string().max(200).nullable(),
});
export type LineCheck = z.infer<typeof lineCheckSchema>;

const key = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*(?::[0-9a-z-]+){0,2}$/);

export const documentLineSchema = z.object({
  /** Stable within the document: the element it renders (« fact:<id> »), or a generated one. */
  key,
  text: z.string().max(1200),
  sources: z.array(lineSourceSchema).max(12),
  origin: z.enum(lineOrigins),
  /** Null for a line taken as is from the profile, by a template or by hand: nothing to check. */
  check: lineCheckSchema.nullable(),
});
export type DocumentLine = z.infer<typeof documentLineSchema>;

/** The sections of a CV, in their default order. */
export const cvSectionKinds = [
  'experience',
  'achievements',
  'skills',
  'languages',
  'education',
  'certifications',
] as const;
export type CvSectionKind = (typeof cvSectionKinds)[number];

/** One entry of a CV section: an experience and its achievements, a skill, a degree… */
export const cvEntrySchema = z.object({
  key,
  heading: documentLineSchema,
  /** Dates, place, level: written by the builder from the profile's fields. */
  meta: z.string().max(200).nullable(),
  lines: z.array(documentLineSchema).max(30),
});
export type CvEntry = z.infer<typeof cvEntrySchema>;

export const cvSectionSchema = z.object({
  kind: z.enum(cvSectionKinds),
  entries: z.array(cvEntrySchema).max(60),
});
export type CvSection = z.infer<typeof cvSectionSchema>;

export const cvContentSchema = z.object({
  kind: z.literal('cv'),
  language: z.enum(documentLanguages),
  template: z.enum(documentTemplates),
  /** The job aimed at. */
  title: documentLineSchema,
  summary: documentLineSchema.nullable(),
  sections: z.array(cvSectionSchema).max(cvSectionKinds.length),
});
export type CvContent = z.infer<typeof cvContentSchema>;

export const letterContentSchema = z.object({
  kind: z.literal('letter'),
  language: z.enum(documentLanguages),
  template: z.enum(documentTemplates),
  paragraphs: z.array(z.object({ key, lines: z.array(documentLineSchema).max(12) })).max(8),
});
export type LetterContent = z.infer<typeof letterContentSchema>;

export const mailContentSchema = z.object({
  kind: z.literal('mail'),
  language: z.enum(documentLanguages),
  subject: documentLineSchema,
  lines: z.array(documentLineSchema).max(15),
});
export type MailContent = z.infer<typeof mailContentSchema>;

export const documentContentSchema = z.discriminatedUnion('kind', [
  cvContentSchema,
  letterContentSchema,
  mailContentSchema,
]);
export type DocumentContent = z.infer<typeof documentContentSchema>;

/** Why a version was made: built from the profile, Mehdi's choices, a hand edit, Claude… */
export const versionOrigins = ['profile', 'layout', 'manual', 'template', 'claude'] as const;
export type VersionOrigin = (typeof versionOrigins)[number];

export const documentVersionSummarySchema = z.object({
  number: z.number().int().min(1),
  origin: z.enum(versionOrigins),
  createdAt: z.string(),
});
export type DocumentVersionSummary = z.infer<typeof documentVersionSummarySchema>;

export const documentVersionSchema = documentVersionSummarySchema.extend({
  documentId: z.uuid(),
  content: documentContentSchema,
});
export type DocumentVersion = z.infer<typeof documentVersionSchema>;

export const documentVersionsResponseSchema = z.object({
  current: z.number().int().min(1),
  versions: z.array(documentVersionSummarySchema),
});
export type DocumentVersionsResponse = z.infer<typeof documentVersionsResponseSchema>;
export const documentVersionParamsSchema = z.object({
  id: z.uuid(),
  number: z.coerce.number().int().min(1),
});

/**
 * Mehdi's choices for a master CV (phase 4 plan, section 4): the order of its elements, the ones
 * left out, and an optional summary he writes himself. An element not named keeps the default
 * order of its section, after the named ones.
 */
export const masterCvLayoutSchema = z.object({
  order: z.array(key).max(500),
  hidden: z.array(key).max(500),
  summary: z.string().trim().max(600).nullable(),
});
export type MasterCvLayout = z.infer<typeof masterCvLayoutSchema>;

/** An element of the profile the master CV can show, to choose and order. */
export const cvElementSchema = z.object({
  key,
  section: z.enum(cvSectionKinds),
  /** The experience an achievement belongs to. */
  parent: key.nullable(),
  label: z.string().max(400),
  hidden: z.boolean(),
});
export type CvElement = z.infer<typeof cvElementSchema>;

export const masterCvSummarySchema = z.object({
  targetJobId: z.uuid(),
  targetJob: z.string(),
  /** Null until the master CV of this target job is created. */
  id: z.uuid().nullable(),
  version: z.number().int().min(1).nullable(),
  updatedAt: z.string().nullable(),
});
export type MasterCvSummary = z.infer<typeof masterCvSummarySchema>;
export const masterCvListSchema = z.object({ masterCvs: z.array(masterCvSummarySchema) });
export type MasterCvList = z.infer<typeof masterCvListSchema>;

export const masterCvSchema = z.object({
  id: z.uuid(),
  targetJobId: z.uuid(),
  targetJob: z.string(),
  template: z.enum(documentTemplates),
  language: z.enum(documentLanguages),
  layout: masterCvLayoutSchema,
  documentId: z.uuid(),
  version: documentVersionSummarySchema,
  content: cvContentSchema,
  /** The profile changed since this version: refreshing would change the CV. */
  stale: z.boolean(),
  elements: z.array(cvElementSchema),
});
export type MasterCv = z.infer<typeof masterCvSchema>;

export const masterCvCreateSchema = z.object({ targetJobId: z.uuid() });
export const masterCvUpdateSchema = z.object({
  template: z.enum(documentTemplates),
  layout: masterCvLayoutSchema,
});
export type MasterCvUpdate = z.infer<typeof masterCvUpdateSchema>;
