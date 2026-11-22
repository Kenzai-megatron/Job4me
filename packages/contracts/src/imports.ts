import { z } from 'zod';

// Imports of a CV or of the LinkedIn archive (phase 1 plan, section 4; ADR 0010).

/** What a file really is, read from its signature and never from its name. */
export const importKinds = ['cv_pdf', 'cv_docx', 'linkedin_zip'] as const;
export type ImportKind = (typeof importKinds)[number];

/** Steps of an import: the extractor owns queued → extracting → extracted or failed. */
export const importStatuses = [
  'queued',
  'extracting',
  'extracted',
  'structuring',
  'review',
  'applied',
  'failed',
] as const;
export type ImportStatus = (typeof importStatuses)[number];

/** Why a file was refused at upload or why its extraction failed. */
export const importErrorCodes = [
  'unsupported_file',
  'file_too_large',
  'file_too_complex',
  'file_protected',
  'file_macros',
  'no_text',
  'extraction_failed',
  'extraction_timeout',
] as const;
export type ImportErrorCode = (typeof importErrorCodes)[number];

/** Figures about an extraction, without any content: pages, characters, rows per LinkedIn file. */
export const importStatsSchema = z.object({
  pages: z.number().int().min(0).optional(),
  characters: z.number().int().min(0).optional(),
  rows: z.record(z.string(), z.number().int().min(0)).optional(),
});
export type ImportStats = z.infer<typeof importStatsSchema>;

export const importRunSchema = z.object({
  id: z.uuid(),
  kind: z.enum(importKinds),
  status: z.enum(importStatuses),
  errorCode: z.enum(importErrorCodes).nullable(),
  sizeBytes: z.number().int().min(0),
  stats: importStatsSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ImportRun = z.infer<typeof importRunSchema>;

export const importListSchema = z.object({ items: z.array(importRunSchema) });

export const importIdParamsSchema = z.object({ id: z.uuid() });

/** One row of a LinkedIn CSV file: allow-listed columns only. */
export const linkedinRowSchema = z.record(z.string(), z.string());

/** What the extractor read from a file; stored encrypted, never logged. */
export const extractedDocumentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string(),
    pages: z.number().int().min(0).nullable(),
  }),
  z.object({
    kind: z.literal('linkedin'),
    files: z.record(z.string(), z.array(linkedinRowSchema)),
  }),
]);
export type ExtractedDocument = z.infer<typeof extractedDocumentSchema>;
