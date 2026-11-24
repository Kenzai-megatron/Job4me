import {
  type ContractKind,
  languagesIn,
  localDate,
  screen,
  type ScreenProfile,
} from '@job4me/collect';
import type { Settings } from '@job4me/config';
import type { ExclusionReason } from '@job4me/contracts';
import { and, eq, inArray, isNull, schema, sql, type Transaction } from '@job4me/db';

// The deterministic filter on the stored announcements (phase 3 plan, section 6): the pure rules
// of packages/collect, the facts of each announcement and its postings, the criteria of the
// profile. Run after a pass on the announcements it touched, and on every announcement of an
// account when its criteria change (the offers_screen job).

const CHUNK = 500;

/** The profile's criteria, as the filter reads them. */
export async function screenProfileOf(
  tx: Transaction,
  userId: string,
  settings: Settings,
  now: Date,
): Promise<ScreenProfile> {
  const [profile] = await tx
    .select({
      radiusKm: schema.profiles.radiusKm,
      remote: schema.profiles.remotePreference,
      contracts: schema.profiles.contractTypes,
    })
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId));
  const companies = await tx
    .select({ name: schema.excludedCompanies.name })
    .from(schema.excludedCompanies)
    .where(eq(schema.excludedCompanies.userId, userId));
  const rules = await tx
    .select({ value: schema.eliminationRules.value })
    .from(schema.eliminationRules)
    .where(
      and(eq(schema.eliminationRules.userId, userId), eq(schema.eliminationRules.kind, 'language')),
    );
  return {
    excludedCompanies: companies.map((row) => row.name),
    radiusKm: profile?.radiusKm ?? settings.profile.defaultRadiusKm,
    // Remote work is accepted unless the profile asks for on-site work only.
    acceptsRemote: profile?.remote !== 'on_site',
    contracts: (profile?.contracts ?? []) as ContractKind[],
    excludedLanguages: [...new Set(rules.flatMap((rule) => languagesIn(rule.value)))],
    maxAgeDays: settings.collect.offers.maxAgeDays,
    today: localDate(now, settings.collect.schedule.timeZone),
  };
}

/**
 * Screens announcements of an account: the ones given, or every one (`null`), or the ones never
 * screened (`'unscreened'`). Returns how many were read and how many are set aside.
 */
export async function screenOffers(
  tx: Transaction,
  userId: string,
  which: readonly string[] | null | 'unscreened',
  profile: ScreenProfile,
  now: Date,
): Promise<{ screened: number; excluded: number }> {
  if (Array.isArray(which) && which.length === 0) return { screened: 0, excluded: 0 };
  const offers = schema.offers;
  const postings = schema.jobOffers;
  const rows = await tx
    .select({
      id: offers.id,
      placeStatus: offers.placeStatus,
      distanceKm: offers.distanceKm,
      remote: offers.remote,
    })
    .from(offers)
    .where(
      and(
        eq(offers.userId, userId),
        which === 'unscreened'
          ? isNull(offers.screenedAt)
          : which === null
            ? undefined
            : inArray(offers.id, [...new Set(which)]),
      ),
    );
  let excluded = 0;
  for (let index = 0; index < rows.length; index += CHUNK) {
    const chunk = rows.slice(index, index + CHUNK);
    const facts = await tx
      .select({
        offerId: postings.offerId,
        origin: postings.origin,
        company: postings.company,
        postedOn: postings.postedOn,
        contracts: postings.contracts,
        languages: postings.languages,
      })
      .from(postings)
      .where(
        and(
          eq(postings.userId, userId),
          inArray(
            postings.offerId,
            chunk.map((row) => row.id),
          ),
        ),
      );
    const byOffer = new Map<string, typeof facts>();
    for (const fact of facts) {
      const list = byOffer.get(fact.offerId);
      if (list) list.push(fact);
      else byOffer.set(fact.offerId, [fact]);
    }
    const values = chunk.map((row) => {
      const list = byOffer.get(row.id) ?? [];
      const dates = list.flatMap((fact) => (fact.postedOn ? [fact.postedOn] : [])).sort();
      const reason: ExclusionReason | null = screen(
        {
          manual: list.some((fact) => fact.origin === 'manual'),
          companies: list.map((fact) => fact.company),
          postedOn: dates.at(-1) ?? null,
          placeStatus: row.placeStatus as 'found' | 'unknown' | 'abroad' | null,
          distanceKm: row.distanceKm,
          remote: row.remote as 'full' | 'hybrid' | null,
          contracts: [...new Set(list.flatMap((fact) => fact.contracts))] as ContractKind[],
          languages: [...new Set(list.flatMap((fact) => fact.languages))],
        },
        profile,
      );
      if (reason) excluded += 1;
      return sql`(${row.id}::uuid, ${reason}::text)`;
    });
    if (values.length === 0) continue;
    await tx.execute(sql`
      update ${offers}
      set excluded_reason = screened.reason, screened_at = ${now}, updated_at = ${now}
      from (values ${sql.join(values, sql`, `)}) as screened (id, reason)
      where ${offers.id} = screened.id and ${offers.userId} = ${userId}
    `);
  }
  return { screened: rows.length, excluded };
}
