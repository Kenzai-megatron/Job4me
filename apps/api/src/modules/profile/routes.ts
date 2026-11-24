import {
  type Completeness,
  completenessRubrics,
  completenessSchema,
  type Identity,
  identitySchema,
  okResponseSchema,
  profileIdParamsSchema,
  profilePatchSchema,
  profileResponseSchema,
  profileSchema,
  type ProfileDocument,
  rubricPatchSchema,
} from '@job4me/contracts';
import {
  and,
  asc,
  count,
  eq,
  recordAudit,
  schema,
  type Transaction,
  updateDistances,
  withUser,
} from '@job4me/db';
import { aadFor, decrypt, encrypt } from '@job4me/security';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../context';
import { HttpError } from '../../errors';
import { requireSession } from '../auth/guards';
import { baseLocation, baseOf, gazetteerOf, offerGeo } from '../collect/geo';
import { requestScreening } from '../collect/screening';

/**
 * The fields of the profile the deterministic filter or the scorings read (phase 3 plan, sections
 * 6 to 8): a change of one has the worker screen and score the offers again, and a score by
 * Claude made before it give way to the score without AI until Claude scores again.
 */
const SCREENED_FIELDS = [
  'baseCity',
  'basePostalCode',
  'radiusKm',
  'contractTypes',
  'workRegimes',
  'remotePreference',
  'salaryMinMonthly',
  'motivations',
  'motivationTags',
  'scoringInstructions',
  'scoringWeights',
] as const;
/** The rubrics the deterministic filter or the scorings read. */
const SCREENED_RUBRICS = new Set([
  'excluded-companies',
  'eliminations',
  'target-jobs',
  'keywords',
  'skills',
  'languages',
  'sectors',
  'title-filters',
  'experiences',
  'education',
  'certifications',
]);
import { type RubricDefinition, rubricDefinitions } from './rubrics';

// Profile API (phase 1 plan, section 8): every handler runs inside withUser, so row-level
// security only shows the signed-in user's rows, and every query also filters on user_id.

const EMPTY_PROFILE: ProfileDocument = {
  motivations: null,
  motivationTags: [],
  baseCity: null,
  basePostalCode: null,
  radiusKm: null,
  contractTypes: [],
  workRegimes: [],
  remotePreference: null,
  salaryMinMonthly: null,
  availableFrom: null,
  scoringInstructions: null,
  scoringWeights: null,
};

const EMPTY_IDENTITY: Identity = {
  fullName: null,
  email: null,
  phone: null,
  commune: null,
  drivingLicences: [],
  transport: [],
};

/** The generic routes treat every list table alike; the real table object builds the SQL. */
type ListTable = typeof schema.skills;
type Row = Record<string, unknown>;

/** PostgreSQL error code of a failed query (drizzle wraps the driver error in `cause`). */
function pgCode(error: unknown): string | undefined {
  for (let current = error; current && typeof current === 'object';) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

function rethrowConstraint(error: unknown): never {
  const code = pgCode(error);
  if (code === '23505') throw new HttpError(409, 'duplicate');
  if (code === '23503' || code === '23514') throw new HttpError(400, 'validation_error');
  throw error;
}

function profileFromRow(row: typeof schema.profiles.$inferSelect | undefined): ProfileDocument {
  if (!row) return EMPTY_PROFILE;
  return profileSchema.parse({
    motivations: row.motivations,
    motivationTags: row.motivationTags,
    baseCity: row.baseCity,
    basePostalCode: row.basePostalCode,
    radiusKm: row.radiusKm,
    contractTypes: row.contractTypes,
    workRegimes: row.workRegimes,
    remotePreference: row.remotePreference,
    salaryMinMonthly: row.salaryMinMonthly,
    availableFrom: row.availableFrom,
    scoringInstructions: row.scoringInstructions,
    scoringWeights: row.scoringWeights,
  });
}

export function profileRoutes(deps: AppDeps): FastifyPluginAsyncZod {
  const { settings } = deps.config;
  const now = () => deps.now?.() ?? new Date();
  const identityAad = (userId: string) => aadFor('profile_identity', 'ciphertext', userId);

  async function readIdentity(tx: Transaction, userId: string): Promise<Identity> {
    const [row] = await tx
      .select({ ciphertext: schema.profileIdentities.ciphertext })
      .from(schema.profileIdentities)
      .where(eq(schema.profileIdentities.userId, userId));
    if (!row) return EMPTY_IDENTITY;
    const plain = decrypt(deps.keys.identity, row.ciphertext, identityAad(userId));
    return identitySchema.parse(JSON.parse(plain.toString('utf8')));
  }

  function audit(
    tx: Transaction,
    userId: string,
    requestId: string,
    metadata: Record<string, string>,
  ) {
    return recordAudit(tx, {
      actorType: 'user',
      actorUserId: userId,
      action: 'profile.changed',
      outcome: 'success',
      requestId,
      metadata,
    });
  }

  async function completeness(tx: Transaction, userId: string): Promise<Completeness> {
    const countOf = async (table: ListTable, extra?: ReturnType<typeof eq>) => {
      const [row] = await tx
        .select({ n: count() })
        .from(table)
        .where(extra ? and(eq(table.userId, userId), extra) : eq(table.userId, userId));
      return row?.n ?? 0;
    };
    const as = (table: unknown) => table as ListTable;
    const [profileRow] = await tx
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.userId, userId));
    const profile = profileFromRow(profileRow);
    const identity = await readIdentity(tx, userId);
    const counts: Record<(typeof completenessRubrics)[number], number> = {
      identity: identity.fullName && identity.email && identity.phone ? 1 : 0,
      practical:
        profile.baseCity && profile.contractTypes.length > 0 && profile.workRegimes.length > 0
          ? 1
          : 0,
      motivations: profile.motivations ? 1 : 0,
      targetJobs: await countOf(as(schema.targetJobs)),
      keywords: await countOf(
        as(schema.searchKeywords),
        eq(schema.searchKeywords.status, 'validated'),
      ),
      experiences: await countOf(as(schema.experiences)),
      facts: await countOf(as(schema.facts)),
      skills: await countOf(schema.skills),
      languages: await countOf(as(schema.languageLevels)),
      education: await countOf(as(schema.educations)),
    };
    let percent = 0;
    const rubrics = completenessRubrics.map((rubric) => {
      const { weight, min } = settings.profile.completeness[rubric];
      const value = counts[rubric];
      percent += weight * Math.min(value / min, 1);
      return { rubric, weight, count: value, min, done: value >= min };
    });
    return { percent: Math.round(percent), rubrics };
  }

  function registerRubric(app: Parameters<FastifyPluginAsyncZod>[0], definition: RubricDefinition) {
    const table = definition.table as unknown as ListTable;
    const base = `/api/profile/${definition.slug}`;
    const item = definition.item;
    const toItem = (row: Row) => item.parse(row);

    app.get(
      base,
      { schema: { response: { 200: z.object({ items: z.array(item) }) } } },
      async (request) => {
        const { userId } = requireSession(request);
        const rows = await withUser(deps.db, userId, (tx) => {
          const order =
            definition.slug === 'target-jobs'
              ? asc(schema.targetJobs.position)
              : asc(table.createdAt);
          return tx.select().from(table).where(eq(table.userId, userId)).orderBy(order);
        });
        return { items: rows.map((row) => toItem(row as Row)) };
      },
    );

    app.post(
      base,
      { schema: { body: definition.input, response: { 200: item } } },
      async (request) => {
        const { userId } = requireSession(request);
        const body = request.body as Row;
        const row = await withUser(deps.db, userId, async (tx) => {
          if (definition.accepts && !(await definition.accepts(tx, userId, body))) {
            throw new HttpError(400, 'validation_error');
          }
          if (definition.limit) {
            const [existing] = await tx
              .select({ n: count() })
              .from(table)
              .where(eq(table.userId, userId));
            if ((existing?.n ?? 0) >= definition.limit(settings)) {
              throw new HttpError(409, 'limit_reached');
            }
          }
          const values: Row = { ...body, ...definition.serverValues, userId };
          if (definition.slug === 'target-jobs') {
            const [existing] = await tx
              .select({ n: count() })
              .from(schema.targetJobs)
              .where(eq(schema.targetJobs.userId, userId));
            values.position = existing?.n ?? 0;
          }
          const [created] = await tx
            .insert(table)
            .values(values as ListTable['$inferInsert'])
            .returning()
            .catch(rethrowConstraint);
          await audit(tx, userId, request.id, { rubric: definition.slug, op: 'created' });
          return created!;
        });
        if (SCREENED_RUBRICS.has(definition.slug)) await requestScreening(deps, userId);
        return toItem(row);
      },
    );

    app.patch(
      `${base}/:id`,
      {
        schema: {
          params: profileIdParamsSchema,
          body: rubricPatchSchema(definition.input),
          response: { 200: item },
        },
      },
      async (request) => {
        const { userId } = requireSession(request);
        const body = request.body;
        const row = await withUser(deps.db, userId, async (tx) => {
          if (definition.accepts && !(await definition.accepts(tx, userId, body))) {
            throw new HttpError(400, 'validation_error');
          }
          const [updated] = await tx
            .update(table)
            .set({ ...body, updatedAt: now() })
            .where(and(eq(table.id, request.params.id), eq(table.userId, userId)))
            .returning()
            .catch(rethrowConstraint);
          if (!updated) throw new HttpError(404, 'not_found');
          await audit(tx, userId, request.id, { rubric: definition.slug, op: 'updated' });
          return updated;
        });
        if (SCREENED_RUBRICS.has(definition.slug)) await requestScreening(deps, userId);
        return toItem(row);
      },
    );

    app.delete(
      `${base}/:id`,
      { schema: { params: profileIdParamsSchema, response: { 200: okResponseSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        await withUser(deps.db, userId, async (tx) => {
          const deleted = await tx
            .delete(table)
            .where(and(eq(table.id, request.params.id), eq(table.userId, userId)))
            .returning({ id: table.id });
          if (deleted.length === 0) throw new HttpError(404, 'not_found');
          await audit(tx, userId, request.id, { rubric: definition.slug, op: 'deleted' });
        });
        if (SCREENED_RUBRICS.has(definition.slug)) await requestScreening(deps, userId);
        return { ok: true as const };
      },
    );
  }

  return async (app) => {
    app.get(
      '/api/profile',
      { schema: { response: { 200: profileResponseSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        const gazetteer = await gazetteerOf(deps.db, settings);
        return withUser(deps.db, userId, async (tx) => {
          const [row] = await tx
            .select()
            .from(schema.profiles)
            .where(eq(schema.profiles.userId, userId));
          return {
            ...profileFromRow(row),
            defaultRadiusKm: settings.profile.defaultRadiusKm,
            defaultScoringWeights: settings.scoring.defaultWeights,
            baseLocation: baseLocation(await baseOf(tx, userId, gazetteer)),
          };
        });
      },
    );

    app.patch(
      '/api/profile',
      { schema: { body: profilePatchSchema, response: { 200: profileResponseSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        const gazetteer = await gazetteerOf(deps.db, settings);
        const response = await withUser(deps.db, userId, async (tx) => {
          const at = now();
          const [saved] = await tx
            .insert(schema.profiles)
            .values({ ...request.body, userId })
            .onConflictDoUpdate({
              target: schema.profiles.userId,
              set: { ...request.body, updatedAt: at },
            })
            .returning();
          await audit(tx, userId, request.id, { rubric: 'profile', op: 'updated' });
          const base = await baseOf(tx, userId, gazetteer);
          // A new base city: every distance is measured again from it (ADR 0017).
          if ('baseCity' in request.body || 'basePostalCode' in request.body) {
            await updateDistances(tx, userId, offerGeo(base.place, settings), at);
          }
          return {
            ...profileFromRow(saved),
            defaultRadiusKm: settings.profile.defaultRadiusKm,
            defaultScoringWeights: settings.scoring.defaultWeights,
            baseLocation: baseLocation(base),
          };
        });
        // A criterion of the deterministic filter changed: the worker reads the offers again.
        if (SCREENED_FIELDS.some((field) => field in request.body)) {
          await requestScreening(deps, userId);
        }
        return response;
      },
    );

    app.get(
      '/api/profile/identity',
      { schema: { response: { 200: identitySchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        return withUser(deps.db, userId, (tx) => readIdentity(tx, userId));
      },
    );

    app.put(
      '/api/profile/identity',
      { schema: { body: identitySchema, response: { 200: identitySchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        const ciphertext = encrypt(
          deps.keys.identity,
          JSON.stringify(request.body),
          identityAad(userId),
        );
        await withUser(deps.db, userId, async (tx) => {
          await tx
            .insert(schema.profileIdentities)
            .values({ userId, ciphertext })
            .onConflictDoUpdate({
              target: schema.profileIdentities.userId,
              set: { ciphertext, updatedAt: now() },
            });
          await audit(tx, userId, request.id, { rubric: 'identity', op: 'updated' });
        });
        return request.body;
      },
    );

    app.get(
      '/api/profile/completeness',
      { schema: { response: { 200: completenessSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        return withUser(deps.db, userId, (tx) => completeness(tx, userId));
      },
    );

    for (const definition of rubricDefinitions) registerRubric(app, definition);
  };
}
