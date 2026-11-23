import { offerUrlSchema, sourceNameSchema } from '@job4me/contracts';
import { z } from 'zod';
import { isJobSite } from './dedup';
import { cleanLine, truncate } from './text';

// The common format of every collected offer (docs/SOURCES.md, section 1.1; ADR 0013).

/** What a connector hands over: the source's values, before cleaning. */
export interface RawOffer {
  /** The offer's identifier at the source. */
  externalId: string;
  title: string;
  /** Unknown stays unknown: "?" is stored, never a guess. */
  company?: string | null;
  location?: string | null;
  /** YYYY-MM-DD, from normalizeDate. */
  postedAt?: string | null;
  url: string;
  salary?: string | null;
  description?: string | null;
  /** Facts given by the source, shown as they are: "CDI · temps partiel". */
  details?: string | null;
}

export const collectedOfferSchema = z.object({
  source: sourceNameSchema,
  externalId: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  company: z.string().min(1).max(200),
  location: z.string().min(1).max(200),
  postedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  url: offerUrlSchema,
  salary: z.string().min(1).max(200).nullable(),
  description: z.string().max(10_000),
  details: z.string().min(1).max(300).nullable(),
});
export type CollectedOffer = z.infer<typeof collectedOfferSchema>;

function optional(value: string | null | undefined, max: number): string | null {
  const clean = truncate(cleanLine(value ?? ''), max);
  return clean === '' ? null : clean;
}

/**
 * Cleans an offer and checks it against the common format: white space collapsed, lengths
 * capped, "?" for an unknown company or place, and for a job site written where the employer
 * should be (docs/SOURCES.md, section 1.6). An offer that still does not fit (no title, no http
 * or https link) is dropped and counted as invalid by the orchestrator.
 */
export function cleanOffer(
  raw: RawOffer,
  source: string,
  maxDescriptionChars: number,
): CollectedOffer | null {
  const company = optional(raw.company, 200);
  const parsed = collectedOfferSchema.safeParse({
    source,
    externalId: cleanLine(raw.externalId),
    title: truncate(cleanLine(raw.title), 300),
    company: company === null || isJobSite(company) ? '?' : company,
    location: optional(raw.location, 200) ?? '?',
    postedAt: raw.postedAt ?? null,
    url: cleanLine(raw.url),
    salary: optional(raw.salary, 200),
    description: truncate(cleanLine(raw.description ?? ''), maxDescriptionChars),
    details: optional(raw.details, 300),
  });
  return parsed.success ? parsed.data : null;
}
