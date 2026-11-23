import { createHash } from 'node:crypto';
import { z } from 'zod';
import { type Connector, type ConnectorContext, eachKeyword } from '../connector';
import { normalizeDate } from '../dates';
import { SourceSkipped } from '../errors';
import type { RawOffer } from '../offer';
import { query } from './http-query';

// Google Jobs through SerpApi (docs/SOURCES.md, section 2.3): a key in Mehdi's name (decision
// D2: later) and 250 searches a month. The account is read first, which costs no search: under
// the reserve of the configuration, the source is skipped ("quota"), otherwise it searches at
// most what stays above the reserve. Priority keywords only. Not probed yet (no key): the test
// answers follow the documented fields.

const params = z.object({
  location: z.string().min(1),
  language: z.string().min(2).max(5),
  country: z.string().min(2).max(5),
  quotaReserve: z.number().int().min(0),
});

const account = z.object({ plan_searches_left: z.number().int() });

const text = z.string().nullish();
const job = z.object({
  job_id: text,
  title: text,
  company_name: text,
  location: text,
  via: text,
  description: text,
  share_link: text,
  apply_options: z.array(z.object({ link: text })).nullish(),
  detected_extensions: z.object({ posted_at: text, schedule_type: text, salary: text }).nullish(),
});
// No result at all comes as 200 with an "error" sentence and no jobs_results.
const page = z.object({ jobs_results: z.array(job).nullish() });
type GoogleJob = z.infer<typeof job>;

const isWebLink = (link: string | null | undefined): link is string =>
  typeof link === 'string' && /^https?:\/\//i.test(link);

export function googleJobsOffer(item: GoogleJob, context: ConnectorContext): RawOffer {
  // Google's job_id is long and opaque: a hash of it is a stable identifier.
  const identity = item.job_id ?? `${item.title}|${item.company_name}|${item.location}`;
  return {
    externalId: createHash('sha256').update(identity).digest('hex').slice(0, 40),
    title: item.title ?? '',
    company: item.company_name ?? null,
    location: item.location ?? null,
    postedAt: normalizeDate(item.detected_extensions?.posted_at, context),
    url: item.apply_options?.map((option) => option.link).find(isWebLink) ?? item.share_link ?? '',
    salary: item.detected_extensions?.salary ?? null,
    description: item.description ?? null,
    details:
      [item.detected_extensions?.schedule_type, item.via]
        .filter((part) => part && part.trim())
        .join(' · ') || null,
  };
}

export const googleJobsConnector: Connector = {
  name: 'google_jobs',
  access: 'api',
  family: 'keywords',
  keywordLevel: 'priority',
  personalUseOnly: true,
  titleFilter: false,
  hosts: ['serpapi.com'],
  secrets: ['serpApiKey'],
  params,
  async run(context) {
    const settings = params.parse(context.params);
    const key = context.secrets.serpApiKey;
    const { plan_searches_left: left } = await context.http.getJson(
      `https://serpapi.com/account.json?${query({ api_key: key })}`,
      account,
    );
    context.reportQuota(left);
    const allowed = left - settings.quotaReserve;
    if (allowed <= 0) throw new SourceSkipped('quota');
    const keywords = context.keywords.slice(0, allowed);
    await eachKeyword({ ...context, keywords }, async (keyword) => {
      const url = `https://serpapi.com/search.json?${query({
        engine: 'google_jobs',
        q: keyword,
        location: settings.location,
        hl: settings.language,
        gl: settings.country,
        api_key: key,
      })}`;
      const answer = await context.http.getJson(url, page);
      const jobs = answer.jobs_results ?? [];
      context.add(jobs.map((item) => googleJobsOffer(item, context)));
    });
  },
};
