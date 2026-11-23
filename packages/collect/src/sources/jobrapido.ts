import { z } from 'zod';
import { type Connector, type ConnectorContext, eachKeyword } from '../connector';
import { normalizeDate } from '../dates';
import { absoluteLink, oneHalf, parsePage } from '../html';
import type { RawOffer } from '../offer';
import { cleanLine, stripHtml } from '../text';
import { query } from './http-query';

// Jobrapido (docs/SOURCES.md, section 2.3): an aggregator, read without `l=` (it would tag every
// offer with the city searched). Probed on 23/11/2026: each result carries its data as JSON in a
// data-advert attribute (identifier, title with the keyword in <strong>, sometimes written
// twice, employer, place, date such as "15 okt", link). Personal use only.

const BASE = 'https://be.jobrapido.com';

const params = z.object({});

const text = z.string().nullish();
const advert = z.object({
  advertId: z.union([z.string(), z.number()]).transform(String),
  title: text,
  company: text,
  location: text,
  date: text,
  openAdvertUrl: text,
  salary: text,
});

export function jobrapidoUrl(keyword: string, page: number): string {
  return `${BASE}/?${query({ w: keyword, p: page })}`;
}

export function jobrapidoPage(html: string, context: ConnectorContext) {
  const $ = parsePage(html);
  const offers: RawOffer[] = [];
  let read = 0;
  $('[data-advert]').each((_index, element) => {
    read += 1;
    let data: unknown;
    try {
      data = JSON.parse($(element).attr('data-advert') ?? '');
    } catch {
      return;
    }
    const parsed = advert.safeParse(data);
    if (!parsed.success) return;
    const item = parsed.data;
    const url = absoluteLink(item.openAdvertUrl ?? undefined, BASE);
    if (!url) return;
    offers.push({
      externalId: item.advertId,
      title: oneHalf(cleanLine(stripHtml(item.title ?? ''))),
      company: item.company ?? null,
      location: item.location ?? null,
      postedAt: normalizeDate(item.date, context),
      url,
      salary: item.salary ?? null,
    });
  });
  return { offers, read };
}

export const jobrapidoConnector: Connector = {
  name: 'jobrapido',
  access: 'public_page',
  family: 'keywords',
  keywordLevel: 'priority',
  personalUseOnly: true,
  titleFilter: false,
  hosts: ['be.jobrapido.com'],
  secrets: [],
  params,
  async run(context) {
    await eachKeyword(context, async (keyword) => {
      for (let number = 1; number <= context.maxPages; number += 1) {
        const response = await context.http.getText(jobrapidoUrl(keyword, number));
        const page = jobrapidoPage(response.text, context);
        context.add(page.offers, page.read);
        if (page.read === 0) break;
      }
    });
  },
};
