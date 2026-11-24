import { z } from 'zod';
import { type Connector, type ConnectorContext, eachKeyword } from '../connector';
import { normalizeDate } from '../dates';
import type { RawOffer } from '../offer';
import { stripAccents, stripHtml } from '../text';
import { query } from './http-query';

// Adzuna (docs/SOURCES.md, section 2.3): the API, with a free key in Mehdi's name (decision D2:
// later; until then the source is "skipped, key missing"). The key travels in the URL and is
// masked in every log line. Accents are not understood: keywords go without them. Every offer
// shown carries "Jobs by Adzuna"; personal use is allowed, a licence is needed beyond it.
// Not probed yet (no key): the test answers follow the documented fields.

const params = z.object({ where: z.string().min(1), pageSize: z.number().int().min(1).max(50) });

const text = z.string().nullish();
const result = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: text,
  company: z.object({ display_name: text }).nullish(),
  location: z.object({ display_name: text }).nullish(),
  redirect_url: text,
  created: text,
  salary_min: z.number().nullish(),
  salary_max: z.number().nullish(),
  salary_is_predicted: z.union([z.string(), z.number(), z.boolean()]).nullish(),
  contract_type: text,
  contract_time: text,
  description: text,
});
const page = z.object({ count: z.number().int().min(0), results: z.array(result) });
type AdzunaResult = z.infer<typeof result>;

const TERMS: Record<string, string> = {
  permanent: 'CDI',
  contract: 'contrat à durée déterminée',
  full_time: 'temps plein',
  part_time: 'temps partiel',
};

const euros = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 });

function salary(item: AdzunaResult): string | null {
  const { salary_min: low, salary_max: high } = item;
  if (!low && !high) return null;
  const range =
    low && high && Math.round(low) !== Math.round(high)
      ? `${euros.format(low)} – ${euros.format(high)} €`
      : `${euros.format((low ?? high)!)} €`;
  const predicted = ['1', 1, true].includes(item.salary_is_predicted ?? '0');
  return predicted ? `${range} (estimation d'Adzuna)` : range;
}

export function adzunaOffer(item: AdzunaResult, context: ConnectorContext): RawOffer {
  return {
    externalId: item.id,
    title: stripHtml(item.title ?? ''),
    company: item.company?.display_name ?? null,
    location: item.location?.display_name ?? null,
    postedAt: normalizeDate(item.created, context),
    url: item.redirect_url ?? '',
    salary: salary(item),
    description: stripHtml(item.description ?? ''),
    // Required by Adzuna's terms on every offer shown.
    details: [TERMS[item.contract_type ?? ''], TERMS[item.contract_time ?? ''], 'Jobs by Adzuna']
      .filter(Boolean)
      .join(' · '),
    contract: item.contract_type,
  };
}

export const adzunaConnector: Connector = {
  name: 'adzuna',
  access: 'api',
  family: 'keywords',
  keywordLevel: 'full',
  personalUseOnly: true,
  titleFilter: false,
  hosts: ['api.adzuna.com'],
  secrets: ['adzunaAppId', 'adzunaAppKey'],
  params,
  async run(context) {
    const { where, pageSize } = params.parse(context.params);
    await eachKeyword(context, async (keyword) => {
      for (let number = 1; number <= context.maxPages; number += 1) {
        const url = `https://api.adzuna.com/v1/api/jobs/be/search/${number}?${query({
          app_id: context.secrets.adzunaAppId,
          app_key: context.secrets.adzunaAppKey,
          what: stripAccents(keyword),
          where,
          distance: context.radiusKm,
          results_per_page: pageSize,
          max_days_old: context.maxAgeDays,
          'content-type': 'application/json',
        })}`;
        const answer = await context.http.getJson(url, page);
        context.add(answer.results.map((item) => adzunaOffer(item, context)));
        // A second page only when the total goes beyond the first one.
        if (number * pageSize >= answer.count || answer.results.length < pageSize) break;
      }
    });
  },
};
