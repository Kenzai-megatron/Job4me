import {
  type CvContent,
  cvContentSchema,
  documentContentSchema,
  documentVersionParamsSchema,
  documentVersionSchema,
  documentVersionsResponseSchema,
  type MasterCv,
  masterCvCreateSchema,
  type MasterCvLayout,
  masterCvLayoutSchema,
  masterCvListSchema,
  masterCvSchema,
  masterCvUpdateSchema,
  profileIdParamsSchema,
  type VersionOrigin,
} from '@job4me/contracts';
import { buildMasterCv, type CvProfile, cvElements, EMPTY_LAYOUT } from '@job4me/documents';
import {
  and,
  asc,
  desc,
  eq,
  type MasterCvRow,
  recordAudit,
  schema,
  type Transaction,
  withUser,
} from '@job4me/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { isDeepStrictEqual } from 'node:util';
import type { AppDeps } from '../../context';
import { HttpError } from '../../errors';
import { requireSession } from '../auth/guards';

// Documents (phase 4 plan, sections 4, 7 and 9; ADR 0020). A master CV per target job, built
// from the profile without AI; Mehdi orders and hides its elements. Each change that alters the
// CV adds a version; a version is never rewritten. Every query filters on the signed-in account
// and runs under row-level security for it (ADR 0011).

/** What a CV may draw on: the profile of the account, the target job it aims at. */
async function cvProfileOf(
  tx: Transaction,
  userId: string,
  targetJobId: string,
): Promise<CvProfile | null> {
  const [targetJob] = await tx
    .select({ id: schema.targetJobs.id, title: schema.targetJobs.title })
    .from(schema.targetJobs)
    .where(and(eq(schema.targetJobs.id, targetJobId), eq(schema.targetJobs.userId, userId)));
  if (!targetJob) return null;
  return {
    targetJob,
    experiences: await tx
      .select({
        id: schema.experiences.id,
        title: schema.experiences.title,
        employer: schema.experiences.employer,
        location: schema.experiences.location,
        startMonth: schema.experiences.startMonth,
        endMonth: schema.experiences.endMonth,
        current: schema.experiences.current,
        description: schema.experiences.description,
      })
      .from(schema.experiences)
      .where(eq(schema.experiences.userId, userId))
      .orderBy(asc(schema.experiences.createdAt), asc(schema.experiences.id)),
    facts: await tx
      .select({
        id: schema.facts.id,
        text: schema.facts.text,
        experienceId: schema.facts.experienceId,
      })
      .from(schema.facts)
      .where(eq(schema.facts.userId, userId))
      .orderBy(asc(schema.facts.createdAt), asc(schema.facts.id)),
    skills: await tx
      .select({
        id: schema.skills.id,
        name: schema.skills.name,
        level: schema.skills.level,
        years: schema.skills.years,
      })
      .from(schema.skills)
      .where(eq(schema.skills.userId, userId))
      .orderBy(asc(schema.skills.createdAt), asc(schema.skills.id)),
    languages: await tx
      .select({
        id: schema.languageLevels.id,
        language: schema.languageLevels.language,
        overall: schema.languageLevels.overall,
      })
      .from(schema.languageLevels)
      .where(eq(schema.languageLevels.userId, userId))
      .orderBy(asc(schema.languageLevels.language)),
    educations: await tx
      .select({
        id: schema.educations.id,
        degree: schema.educations.degree,
        institution: schema.educations.institution,
        year: schema.educations.year,
      })
      .from(schema.educations)
      .where(eq(schema.educations.userId, userId))
      .orderBy(asc(schema.educations.createdAt), asc(schema.educations.id)),
    certifications: await tx
      .select({
        id: schema.certifications.id,
        name: schema.certifications.name,
        issuer: schema.certifications.issuer,
        year: schema.certifications.year,
      })
      .from(schema.certifications)
      .where(eq(schema.certifications.userId, userId))
      .orderBy(asc(schema.certifications.createdAt), asc(schema.certifications.id)),
  };
}

async function masterCvRow(
  tx: Transaction,
  userId: string,
  id: string,
): Promise<MasterCvRow | null> {
  const [row] = await tx
    .select()
    .from(schema.masterCvs)
    .where(and(eq(schema.masterCvs.id, id), eq(schema.masterCvs.userId, userId)));
  return row ?? null;
}

async function cvDocumentOf(tx: Transaction, userId: string, masterCvId: string, lock = false) {
  const query = tx
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.masterCvId, masterCvId),
        eq(schema.documents.userId, userId),
        eq(schema.documents.kind, 'cv'),
      ),
    );
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

async function versionOf(tx: Transaction, userId: string, documentId: string, number: number) {
  const [row] = await tx
    .select()
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.documentId, documentId),
        eq(schema.documentVersions.userId, userId),
        eq(schema.documentVersions.number, number),
      ),
    );
  return row ?? null;
}

/**
 * Adds a version when the content differs from the current one: the document's row is locked, so
 * that two saves never take the same number. Returns whether a version was added.
 */
async function addVersion(
  tx: Transaction,
  userId: string,
  documentId: string,
  content: CvContent,
  origin: VersionOrigin,
): Promise<boolean> {
  const [document] = await tx
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.id, documentId), eq(schema.documents.userId, userId)))
    .for('update');
  if (!document) throw new HttpError(404, 'not_found');
  const current = await versionOf(tx, userId, documentId, document.currentVersion);
  if (current && isDeepStrictEqual(current.content, content)) return false;
  const [last] = await tx
    .select({ number: schema.documentVersions.number })
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.documentId, documentId),
        eq(schema.documentVersions.userId, userId),
      ),
    )
    .orderBy(desc(schema.documentVersions.number))
    .limit(1);
  const number = (last?.number ?? 0) + 1;
  await tx.insert(schema.documentVersions).values({
    userId,
    documentId,
    number,
    origin,
    content: documentContentSchema.parse(content) as Record<string, unknown>,
  });
  await tx
    .update(schema.documents)
    .set({ currentVersion: number, updatedAt: new Date() })
    .where(eq(schema.documents.id, documentId));
  return true;
}

/** The master CV as the editor shows it: its current version, whether the profile moved on. */
async function loadMasterCv(tx: Transaction, userId: string, row: MasterCvRow): Promise<MasterCv> {
  const profile = await cvProfileOf(tx, userId, row.targetJobId);
  const document = await cvDocumentOf(tx, userId, row.id);
  if (!profile || !document) throw new HttpError(404, 'not_found');
  const version = await versionOf(tx, userId, document.id, document.currentVersion);
  if (!version) throw new HttpError(404, 'not_found');
  const layout = masterCvLayoutSchema.parse(row.layout);
  const options = {
    language: row.language as MasterCv['language'],
    template: row.template as MasterCv['template'],
  };
  const built = buildMasterCv(profile, layout, options);
  return masterCvSchema.parse({
    id: row.id,
    targetJobId: row.targetJobId,
    targetJob: profile.targetJob.title,
    template: row.template,
    language: row.language,
    layout,
    documentId: document.id,
    version: {
      number: version.number,
      origin: version.origin,
      createdAt: version.createdAt.toISOString(),
    },
    content: cvContentSchema.parse(version.content),
    stale: !isDeepStrictEqual(version.content, built),
    elements: cvElements(profile, layout, options.language),
  });
}

export function documentRoutes(deps: AppDeps): FastifyPluginAsyncZod {
  const audit = (
    tx: Transaction,
    userId: string,
    requestId: string,
    action: string,
    targetId: string,
  ) =>
    recordAudit(tx, {
      actorType: 'user',
      actorUserId: userId,
      action,
      outcome: 'success',
      targetType: 'master_cv',
      targetId,
      requestId,
      metadata: {},
    });

  return async (app) => {
    app.get(
      '/api/master-cvs',
      { schema: { response: { 200: masterCvListSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        return withUser(deps.db, userId, async (tx) => {
          const rows = await tx
            .select({
              targetJobId: schema.targetJobs.id,
              targetJob: schema.targetJobs.title,
              id: schema.masterCvs.id,
              version: schema.documents.currentVersion,
              updatedAt: schema.documents.updatedAt,
            })
            .from(schema.targetJobs)
            .leftJoin(schema.masterCvs, eq(schema.masterCvs.targetJobId, schema.targetJobs.id))
            .leftJoin(
              schema.documents,
              and(
                eq(schema.documents.masterCvId, schema.masterCvs.id),
                eq(schema.documents.kind, 'cv'),
              ),
            )
            .where(eq(schema.targetJobs.userId, userId))
            .orderBy(asc(schema.targetJobs.position), asc(schema.targetJobs.id));
          return {
            masterCvs: rows.map((row) => ({
              ...row,
              updatedAt: row.updatedAt?.toISOString() ?? null,
            })),
          };
        });
      },
    );

    // Created for one target job of the account, from its profile; asked twice, the same one.
    app.post(
      '/api/master-cvs',
      { schema: { body: masterCvCreateSchema, response: { 200: masterCvSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        const { targetJobId } = request.body;
        return withUser(deps.db, userId, async (tx) => {
          const profile = await cvProfileOf(tx, userId, targetJobId);
          if (!profile) throw new HttpError(404, 'not_found');
          const [existing] = await tx
            .select()
            .from(schema.masterCvs)
            .where(
              and(
                eq(schema.masterCvs.targetJobId, targetJobId),
                eq(schema.masterCvs.userId, userId),
              ),
            );
          if (existing) return loadMasterCv(tx, userId, existing);
          const [row] = await tx
            .insert(schema.masterCvs)
            .values({ userId, targetJobId, layout: EMPTY_LAYOUT })
            .returning();
          const [document] = await tx
            .insert(schema.documents)
            .values({ userId, masterCvId: row!.id, kind: 'cv', currentVersion: 1 })
            .returning();
          const content = buildMasterCv(profile, EMPTY_LAYOUT, {
            language: 'fr',
            template: 'classic',
          });
          await tx.insert(schema.documentVersions).values({
            userId,
            documentId: document!.id,
            number: 1,
            origin: 'profile',
            content: documentContentSchema.parse(content) as Record<string, unknown>,
          });
          await audit(tx, userId, request.id, 'master_cv.created', row!.id);
          return loadMasterCv(tx, userId, row!);
        });
      },
    );

    app.get(
      '/api/master-cvs/:id',
      { schema: { params: profileIdParamsSchema, response: { 200: masterCvSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        return withUser(deps.db, userId, async (tx) => {
          const row = await masterCvRow(tx, userId, request.params.id);
          if (!row) throw new HttpError(404, 'not_found');
          return loadMasterCv(tx, userId, row);
        });
      },
    );

    // Mehdi's choices: the order, the elements left out, the summary, the template.
    app.put(
      '/api/master-cvs/:id',
      {
        schema: {
          params: profileIdParamsSchema,
          body: masterCvUpdateSchema,
          response: { 200: masterCvSchema },
        },
      },
      async (request) => {
        const { userId } = requireSession(request);
        return withUser(deps.db, userId, async (tx) => {
          const row = await masterCvRow(tx, userId, request.params.id);
          if (!row) throw new HttpError(404, 'not_found');
          const layout: MasterCvLayout = request.body.layout;
          const [updated] = await tx
            .update(schema.masterCvs)
            .set({ layout, template: request.body.template, updatedAt: new Date() })
            .where(and(eq(schema.masterCvs.id, row.id), eq(schema.masterCvs.userId, userId)))
            .returning();
          const profile = await cvProfileOf(tx, userId, row.targetJobId);
          const document = await cvDocumentOf(tx, userId, row.id, true);
          if (!profile || !document || !updated) throw new HttpError(404, 'not_found');
          const content = buildMasterCv(profile, layout, {
            language: updated.language as MasterCv['language'],
            template: request.body.template,
          });
          if (await addVersion(tx, userId, document.id, content, 'layout')) {
            await audit(tx, userId, request.id, 'master_cv.updated', row.id);
          }
          return loadMasterCv(tx, userId, updated);
        });
      },
    );

    // The profile moved on (a new achievement, a new skill): the CV follows it.
    app.post(
      '/api/master-cvs/:id/refresh',
      { schema: { params: profileIdParamsSchema, response: { 200: masterCvSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        return withUser(deps.db, userId, async (tx) => {
          const row = await masterCvRow(tx, userId, request.params.id);
          if (!row) throw new HttpError(404, 'not_found');
          const profile = await cvProfileOf(tx, userId, row.targetJobId);
          const document = await cvDocumentOf(tx, userId, row.id, true);
          if (!profile || !document) throw new HttpError(404, 'not_found');
          const content = buildMasterCv(profile, masterCvLayoutSchema.parse(row.layout), {
            language: row.language as MasterCv['language'],
            template: row.template as MasterCv['template'],
          });
          if (await addVersion(tx, userId, document.id, content, 'profile')) {
            await audit(tx, userId, request.id, 'master_cv.refreshed', row.id);
          }
          return loadMasterCv(tx, userId, row);
        });
      },
    );

    app.get(
      '/api/documents/:id/versions',
      {
        schema: {
          params: profileIdParamsSchema,
          response: { 200: documentVersionsResponseSchema },
        },
      },
      async (request) => {
        const { userId } = requireSession(request);
        return withUser(deps.db, userId, async (tx) => {
          const [document] = await tx
            .select()
            .from(schema.documents)
            .where(
              and(eq(schema.documents.id, request.params.id), eq(schema.documents.userId, userId)),
            );
          if (!document) throw new HttpError(404, 'not_found');
          const versions = await tx
            .select({
              number: schema.documentVersions.number,
              origin: schema.documentVersions.origin,
              createdAt: schema.documentVersions.createdAt,
            })
            .from(schema.documentVersions)
            .where(
              and(
                eq(schema.documentVersions.documentId, document.id),
                eq(schema.documentVersions.userId, userId),
              ),
            )
            .orderBy(desc(schema.documentVersions.number));
          return documentVersionsResponseSchema.parse({
            current: document.currentVersion,
            versions: versions.map((version) => ({
              ...version,
              createdAt: version.createdAt.toISOString(),
            })),
          });
        });
      },
    );

    app.get(
      '/api/documents/:id/versions/:number',
      { schema: { params: documentVersionParamsSchema, response: { 200: documentVersionSchema } } },
      async (request) => {
        const { userId } = requireSession(request);
        return withUser(deps.db, userId, async (tx) => {
          const version = await versionOf(tx, userId, request.params.id, request.params.number);
          if (!version) throw new HttpError(404, 'not_found');
          return documentVersionSchema.parse({
            documentId: version.documentId,
            number: version.number,
            origin: version.origin,
            createdAt: version.createdAt.toISOString(),
            content: version.content,
          });
        });
      },
    );
  };
}
