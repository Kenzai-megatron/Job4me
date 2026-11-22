import { randomUUID } from 'node:crypto';
import type { Settings } from '@job4me/config';
import {
  type CvStructuring,
  cvStructuringSchema,
  extractedDocumentSchema,
  type Identity,
  identitySchema,
  type ImportErrorCode,
  type ProposalRubric,
} from '@job4me/contracts';
import { and, type Database, eq, lt, or, schema, sql, withUser } from '@job4me/db';
import { extractedAad } from '@job4me/imports';
import type { Logger } from '@job4me/logger';
import { aadFor, decrypt, encrypt } from '@job4me/security';
import { CV_STRUCTURING_PROMPT, wrap } from '../ai/prompts';
import { redactCv } from '../ai/redact';
import type { AiService } from '../ai/service';

// Structuring of an extracted CV (plan, section 4, step 4): identity found locally, the rest by
// Claude Haiku on the redacted text. Nothing enters the profile here: every item becomes a
// proposal, encrypted under the import key, for Mehdi to accept, correct or ignore (lot 5).

export interface StructureDeps {
  db: Database;
  ai: AiService;
  settings: Settings;
  /** Decrypts the extracted text, encrypts the proposals. */
  importKey: Buffer;
  /** Reads the known identity, to redact it. */
  identityKey: Buffer;
  logger: Logger;
}

interface Proposal {
  rubric: ProposalRubric;
  source: 'local' | 'ai';
  content: Record<string, unknown>;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const LANGUAGE = /^[a-z]{2}$/;

function normalise(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

const month = (value: string | null) => (value && MONTH.test(value) ? value : null);
const year = (value: number | null) =>
  value !== null && value >= 1950 && value <= 2100 ? value : null;

/**
 * Proposals drawn from the model's answer. Each item must quote the CV it comes from: an item
 * whose evidence cannot be found in the redacted text is dropped ("the AI invents nothing").
 */
export function proposalsFrom(
  answer: CvStructuring,
  cv: string,
): { proposals: Proposal[]; dropped: number } {
  const text = normalise(cv);
  const proposals: Proposal[] = [];
  let dropped = 0;
  const add = (rubric: ProposalRubric, evidence: string, content: Record<string, unknown>) => {
    const quoted = normalise(evidence);
    if (quoted.length < 3 || !text.includes(quoted)) {
      dropped += 1;
      return null;
    }
    proposals.push({ rubric, source: 'ai', content: { ...content, evidence: evidence.trim() } });
    return proposals.length - 1;
  };

  for (const job of answer.targetJobs) add('target-jobs', job.evidence, { title: job.title });
  for (const experience of answer.experiences) {
    const index = add('experiences', experience.evidence, {
      title: experience.title,
      employer: experience.employer,
      location: experience.location,
      startMonth: month(experience.startMonth),
      endMonth: experience.current ? null : month(experience.endMonth),
      current: experience.current,
    });
    for (const achievement of experience.achievements) {
      // A fact keeps the position of its experience, so lot 5 can link them once both are kept.
      add('facts', achievement.evidence, { text: achievement.text, experience: index });
    }
  }
  for (const item of answer.education) {
    add('education', item.evidence, {
      degree: item.degree,
      institution: item.institution,
      year: year(item.year),
    });
  }
  for (const item of answer.certifications) {
    add('certifications', item.evidence, {
      name: item.name,
      issuer: item.issuer,
      year: year(item.year),
    });
  }
  for (const skill of answer.skills) {
    add('skills', skill.evidence, { name: skill.name, level: skill.level });
  }
  for (const language of answer.languages) {
    if (!LANGUAGE.test(language.language)) {
      dropped += 1;
      continue;
    }
    add('languages', language.evidence, { language: language.language, overall: language.level });
  }
  return { proposals, dropped };
}

/** Contact details found in the CV that differ from the Identity rubric: proposed, no AI. */
function identityProposals(
  found: ReturnType<typeof redactCv>['found'],
  known: Identity,
): Proposal[] {
  const proposals: Proposal[] = [];
  const propose = (field: 'fullName' | 'email' | 'phone', value: string | undefined) => {
    if (!value) return;
    const current = known[field];
    if (current && normalise(current) === normalise(value)) return;
    proposals.push({
      rubric: 'identity',
      source: 'local',
      content: { field, value, evidence: value },
    });
  };
  propose('fullName', found.names[0]);
  propose('email', found.emails[0]);
  propose('phone', found.phones[0]);
  return proposals;
}

async function knownIdentity(deps: StructureDeps, userId: string): Promise<Identity> {
  const [row] = await withUser(deps.db, userId, (tx) =>
    tx
      .select({ ciphertext: schema.profileIdentities.ciphertext })
      .from(schema.profileIdentities)
      .where(eq(schema.profileIdentities.userId, userId)),
  );
  const empty: Identity = {
    fullName: null,
    email: null,
    phone: null,
    commune: null,
    drivingLicences: [],
    transport: [],
  };
  if (!row) return empty;
  const plain = decrypt(
    deps.identityKey,
    row.ciphertext,
    aadFor('profile_identity', 'ciphertext', userId),
  );
  return identitySchema.parse(JSON.parse(plain.toString('utf8')));
}

/** Structures one import; false when another worker already holds it. */
export async function structureImport(
  deps: StructureDeps,
  run: { id: string; userId: string },
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - deps.settings.ai.structuring.staleAfterMs);
  const runs = schema.importRuns;
  const [claimed] = await withUser(deps.db, run.userId, (tx) =>
    tx
      .update(runs)
      .set({ status: 'structuring', updatedAt: new Date() })
      .where(
        and(
          eq(runs.id, run.id),
          eq(runs.userId, run.userId),
          or(
            eq(runs.status, 'extracted'),
            and(eq(runs.status, 'structuring'), lt(runs.updatedAt, staleBefore)),
          ),
        ),
      )
      .returning({ extracted: runs.extracted }),
  );
  if (!claimed?.extracted) return false;
  const log = deps.logger.child({ importRunId: run.id });

  const document = extractedDocumentSchema.parse(
    JSON.parse(decrypt(deps.importKey, claimed.extracted, extractedAad(run.id)).toString('utf8')),
  );
  if (document.kind !== 'text') throw new Error('only CV imports are structured here');

  const identity = await knownIdentity(deps, run.userId);
  const redaction = redactCv(document.text, identity);
  const proposals = identityProposals(redaction.found, identity);
  let dropped = 0;
  let errorCode: ImportErrorCode | null = null;

  const result = await deps.ai.run({
    usage: 'cv_structuring',
    userId: run.userId,
    model: deps.settings.ai.cvStructuring.model,
    maxTokens: deps.settings.ai.cvStructuring.maxTokens,
    effort: deps.settings.ai.cvStructuring.effort,
    fallbacks: false,
    system: CV_STRUCTURING_PROMPT,
    user: wrap('cv', redaction.text),
    schema: cvStructuringSchema,
  });
  if (result.ok) {
    const fromAi = proposalsFrom(result.value, redaction.text);
    // Facts point at their experience by position: shift them past the identity proposals.
    const offset = proposals.length;
    for (const proposal of fromAi.proposals) {
      const experience = proposal.content.experience;
      proposals.push(
        proposal.rubric === 'facts' && typeof experience === 'number'
          ? { ...proposal, content: { ...proposal.content, experience: experience + offset } }
          : proposal,
      );
    }
    dropped = fromAi.dropped;
  } else {
    errorCode = result.error;
  }

  await withUser(deps.db, run.userId, async (tx) => {
    if (proposals.length > 0) {
      await tx.insert(schema.importProposals).values(
        proposals.map((proposal, position) => {
          const id = randomUUID();
          return {
            id,
            userId: run.userId,
            importRunId: run.id,
            rubric: proposal.rubric,
            source: proposal.source,
            position,
            content: encrypt(
              deps.importKey,
              JSON.stringify(proposal.content),
              aadFor('import_proposal', 'content', id),
            ),
          };
        }),
      );
    }
    await tx
      .update(runs)
      .set({
        status: 'review',
        errorCode,
        stats: sql`coalesce(${runs.stats}, '{}'::jsonb) || ${JSON.stringify({ proposals: proposals.length, dropped })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(and(eq(runs.id, run.id), eq(runs.userId, run.userId), eq(runs.status, 'structuring')));
  });
  log.info(
    { proposals: proposals.length, dropped, redacted: redaction.counts, aiError: errorCode },
    'import structured',
  );
  return true;
}
