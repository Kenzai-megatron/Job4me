import {
  certificationInputSchema,
  educationInputSchema,
  experienceInputSchema,
  factInputSchema,
  historyRowSchema,
  identitySchema,
  importIdParamsSchema,
  importReviewSchema,
  languageInputSchema,
  type Proposal,
  proposalDecisionSchema,
  proposalParamsSchema,
  type ProposalRubric,
  proposalSchema,
  skillInputSchema,
  targetJobInputSchema,
} from '@job4me/contracts';
import { and, asc, count, eq, recordAudit, schema, type Transaction, withUser } from '@job4me/db';
import { aadFor, decrypt, encrypt } from '@job4me/security';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../context';
import { HttpError } from '../../errors';
import { requireSession } from '../auth/guards';
import { selectRuns, toRun } from './routes';

// Field-by-field review (plan, section 4, step 5): each proposal is accepted as proposed,
// corrected, or set aside, by Mehdi only. An accepted proposal becomes a profile entry through
// the same validation as the profile screens; every decision is in the audit log.

type Row = typeof schema.importProposals.$inferSelect;
type Content = Record<string, unknown>;

/** Fields that describe a proposal, never written to the profile. */
const META = new Set(['evidence', 'experience', 'field', 'rows']);

function normalise(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
    : '';
}

function pgCode(error: unknown): string | undefined {
  for (let current = error; current && typeof current === 'object';) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

export function reviewRoutes(deps: AppDeps): FastifyPluginAsyncZod {
  const { settings } = deps.config;
  const contentAad = (id: string) => aadFor('import_proposal', 'content', id);
  const identityAad = (userId: string) => aadFor('profile_identity', 'ciphertext', userId);

  const read = (row: Row): Content =>
    JSON.parse(
      decrypt(deps.imports.key, row.content, contentAad(row.id)).toString('utf8'),
    ) as Content;

  /** Keys of what the profile already holds, by rubric, to flag possible duplicates. */
  async function existing(
    tx: Transaction,
    userId: string,
  ): Promise<Map<ProposalRubric, Set<string>>> {
    const keys = new Map<ProposalRubric, Set<string>>();
    const put = (rubric: ProposalRubric, values: string[]) => keys.set(rubric, new Set(values));
    put(
      'target-jobs',
      (await tx.select().from(schema.targetJobs).where(eq(schema.targetJobs.userId, userId))).map(
        (r) => normalise(r.title),
      ),
    );
    put(
      'experiences',
      (await tx.select().from(schema.experiences).where(eq(schema.experiences.userId, userId))).map(
        (r) => `${normalise(r.title)}|${normalise(r.employer)}`,
      ),
    );
    put(
      'facts',
      (await tx.select().from(schema.facts).where(eq(schema.facts.userId, userId))).map((r) =>
        normalise(r.text),
      ),
    );
    put(
      'education',
      (await tx.select().from(schema.educations).where(eq(schema.educations.userId, userId))).map(
        (r) => `${normalise(r.degree)}|${normalise(r.institution)}`,
      ),
    );
    put(
      'certifications',
      (
        await tx
          .select()
          .from(schema.certifications)
          .where(eq(schema.certifications.userId, userId))
      ).map((r) => normalise(r.name)),
    );
    put(
      'skills',
      (await tx.select().from(schema.skills).where(eq(schema.skills.userId, userId))).map((r) =>
        normalise(r.name),
      ),
    );
    put(
      'languages',
      (
        await tx
          .select()
          .from(schema.languageLevels)
          .where(eq(schema.languageLevels.userId, userId))
      ).map((r) => r.language),
    );
    return keys;
  }

  function keyOf(rubric: ProposalRubric, content: Content): string | null {
    switch (rubric) {
      case 'target-jobs':
        return normalise(content.title);
      case 'experiences':
        return `${normalise(content.title)}|${normalise(content.employer)}`;
      case 'facts':
        return normalise(content.text);
      case 'education':
        return `${normalise(content.degree)}|${normalise(content.institution)}`;
      case 'certifications':
      case 'skills':
        return normalise(content.name);
      case 'languages':
        return typeof content.language === 'string' ? content.language : null;
      default:
        return null;
    }
  }

  function toProposal(
    row: Row,
    content: Content,
    keys: Map<ProposalRubric, Set<string>>,
  ): Proposal {
    const rubric = row.rubric as ProposalRubric;
    const key = keyOf(rubric, content);
    return proposalSchema.parse({
      id: row.id,
      rubric,
      source: row.source,
      decision: row.decision,
      content,
      duplicate:
        key !== null && row.decision === 'pending' && (keys.get(rubric)?.has(key) ?? false),
    });
  }

  /** The profile fields of a proposal, after Mehdi's correction if any. */
  function entryOf(content: Content, correction: Content | undefined): Content {
    const merged = { ...content, ...(correction ?? {}) };
    return Object.fromEntries(Object.entries(merged).filter(([key]) => !META.has(key)));
  }

  /** Writes an accepted proposal into its rubric; returns the new entry's id when there is one. */
  async function apply(
    tx: Transaction,
    userId: string,
    row: Row,
    content: Content,
    entry: Content,
  ): Promise<string | null> {
    const rubric = row.rubric as ProposalRubric;
    const origin = row.source === 'linkedin' ? 'linkedin_import' : 'cv_import';
    const insert = async (table: typeof schema.skills, values: Content) => {
      const [created] = await tx
        .insert(table)
        .values({ ...values, userId } as typeof schema.skills.$inferInsert)
        .returning({ id: table.id });
      return created!.id;
    };
    switch (rubric) {
      case 'identity': {
        const field = z.enum(['fullName', 'email', 'phone', 'commune']).parse(content.field);
        const [stored] = await tx
          .select({ ciphertext: schema.profileIdentities.ciphertext })
          .from(schema.profileIdentities)
          .where(eq(schema.profileIdentities.userId, userId));
        const current = stored
          ? (JSON.parse(
              decrypt(deps.keys.identity, stored.ciphertext, identityAad(userId)).toString('utf8'),
            ) as Content)
          : {
              fullName: null,
              email: null,
              phone: null,
              commune: null,
              drivingLicences: [],
              transport: [],
            };
        const identity = identitySchema.parse({
          ...current,
          [field]: entry.value ?? content.value,
        });
        const ciphertext = encrypt(
          deps.keys.identity,
          JSON.stringify(identity),
          identityAad(userId),
        );
        await tx
          .insert(schema.profileIdentities)
          .values({ userId, ciphertext })
          .onConflictDoUpdate({
            target: schema.profileIdentities.userId,
            set: { ciphertext, updatedAt: new Date() },
          });
        return null;
      }
      case 'target-jobs': {
        const [jobs] = await tx
          .select({ n: count() })
          .from(schema.targetJobs)
          .where(eq(schema.targetJobs.userId, userId));
        if ((jobs?.n ?? 0) >= settings.profile.maxTargetJobs)
          throw new HttpError(409, 'limit_reached');
        const values = targetJobInputSchema.parse(entry);
        return insert(schema.targetJobs as unknown as typeof schema.skills, {
          ...values,
          position: jobs?.n ?? 0,
        });
      }
      case 'experiences':
        return insert(
          schema.experiences as unknown as typeof schema.skills,
          experienceInputSchema.parse(entry),
        );
      case 'facts': {
        // Linked to its experience when that proposal became an entry.
        let experienceId: string | null = null;
        if (typeof content.experience === 'number') {
          const [parent] = await tx
            .select({ appliedEntryId: schema.importProposals.appliedEntryId })
            .from(schema.importProposals)
            .where(
              and(
                eq(schema.importProposals.importRunId, row.importRunId),
                eq(schema.importProposals.position, content.experience),
                eq(schema.importProposals.userId, userId),
              ),
            );
          experienceId = parent?.appliedEntryId ?? null;
        }
        const values = factInputSchema.parse({ experienceId, ...entry });
        return insert(schema.facts as unknown as typeof schema.skills, { ...values, origin });
      }
      case 'education':
        return insert(
          schema.educations as unknown as typeof schema.skills,
          educationInputSchema.parse(entry),
        );
      case 'certifications':
        return insert(
          schema.certifications as unknown as typeof schema.skills,
          certificationInputSchema.parse(entry),
        );
      case 'skills':
        return insert(schema.skills, skillInputSchema.parse(entry));
      case 'languages':
        return insert(
          schema.languageLevels as unknown as typeof schema.skills,
          languageInputSchema.parse(entry),
        );
      case 'saved-offers':
      case 'past-applications': {
        const rows = z
          .array(historyRowSchema)
          .max(settings.imports.maxLinkedinRows)
          .parse(content.rows);
        if (rows.length === 0) return null;
        if (rubric === 'saved-offers') {
          await tx
            .insert(schema.savedOffers)
            .values(
              rows.map((item) => ({
                userId,
                title: item.title,
                company: item.company,
                url: item.url,
                savedOn: item.date,
              })),
            )
            .onConflictDoNothing();
        } else {
          await tx
            .insert(schema.pastApplications)
            .values(
              rows.map((item) => ({
                userId,
                title: item.title,
                company: item.company,
                url: item.url,
                appliedOn: item.date,
              })),
            )
            .onConflictDoNothing();
        }
        return null;
      }
    }
  }

  return async (app) => {
    app.get(
      '/api/imports/:id/proposals',
      { schema: { params: importIdParamsSchema, response: { 200: importReviewSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        return withUser(deps.db, userId, async (tx) => {
          const [run] = await selectRuns(tx, userId, eq(schema.importRuns.id, request.params.id));
          if (!run) throw new HttpError(404, 'not_found');
          const rows = await tx
            .select()
            .from(schema.importProposals)
            .where(
              and(
                eq(schema.importProposals.importRunId, run.id),
                eq(schema.importProposals.userId, userId),
              ),
            )
            .orderBy(asc(schema.importProposals.position));
          const keys = await existing(tx, userId);
          return {
            run: toRun(run),
            proposals: rows.map((row) => toProposal(row, read(row), keys)),
          };
        });
      },
    );

    app.post(
      '/api/imports/:id/proposals/:proposalId/decision',
      {
        schema: {
          params: proposalParamsSchema,
          body: proposalDecisionSchema,
          response: { 200: proposalSchema },
        },
      },
      async (request) => {
        const { userId } = requireSession(request);
        const { id, proposalId } = request.params;
        const { decision, content: correction } = request.body;
        const proposals = schema.importProposals;
        return withUser(deps.db, userId, async (tx) => {
          const [row] = await tx
            .select()
            .from(proposals)
            .where(
              and(
                eq(proposals.id, proposalId),
                eq(proposals.importRunId, id),
                eq(proposals.userId, userId),
              ),
            );
          if (!row) throw new HttpError(404, 'not_found');
          if (row.decision !== 'pending') throw new HttpError(409, 'already_decided');
          const content = read(row);

          let appliedEntryId: string | null = null;
          let outcome: Row['decision'] = 'ignored';
          let stored = content;
          if (decision === 'accept') {
            const entry = entryOf(content, correction);
            try {
              appliedEntryId = await apply(tx, userId, row, content, entry);
            } catch (error) {
              if (error instanceof HttpError) throw error;
              if (error instanceof z.ZodError) throw new HttpError(400, 'validation_error');
              if (pgCode(error) === '23505') throw new HttpError(409, 'duplicate');
              if (pgCode(error) === '23503' || pgCode(error) === '23514') {
                throw new HttpError(400, 'validation_error');
              }
              throw error;
            }
            outcome = correction ? 'corrected' : 'accepted';
            if (correction) stored = { ...content, ...correction };
          }

          const [updated] = await tx
            .update(proposals)
            .set({
              decision: outcome,
              decidedAt: new Date(),
              appliedEntryId,
              updatedAt: new Date(),
              ...(stored !== content
                ? { content: encrypt(deps.imports.key, JSON.stringify(stored), contentAad(row.id)) }
                : {}),
            })
            .where(and(eq(proposals.id, row.id), eq(proposals.userId, userId)))
            .returning();
          await recordAudit(tx, {
            actorType: 'user',
            actorUserId: userId,
            action: 'import.proposal_decided',
            outcome: 'success',
            requestId: request.id,
            metadata: { rubric: row.rubric, decision: outcome },
          });

          // The import is applied once nothing waits any more.
          const [left] = await tx
            .select({ n: count() })
            .from(proposals)
            .where(and(eq(proposals.importRunId, id), eq(proposals.decision, 'pending')));
          if ((left?.n ?? 0) === 0) {
            await tx
              .update(schema.importRuns)
              .set({ status: 'applied', updatedAt: new Date() })
              .where(
                and(
                  eq(schema.importRuns.id, id),
                  eq(schema.importRuns.userId, userId),
                  eq(schema.importRuns.status, 'review'),
                ),
              );
          }
          return toProposal(updated!, stored, new Map());
        });
      },
    );
  };
}
