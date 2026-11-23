import { z } from 'zod';
import { type Connector, type ConnectorContext, eachKeyword } from '../connector';
import { addDays, localDate, normalizeDate } from '../dates';
import { parsePage, textOf } from '../html';
import type { RawOffer } from '../offer';
import { query } from './http-query';

// Talent.com (docs/SOURCES.md, section 2.3): an aggregator, mostly LinkedIn. Probed on
// 23/11/2026: 16 cards a page, each an <article> inside an element carrying data-job-id and
// data-new-id; classes with a hashed suffix (looked up by their prefix); the date sits in the
// dateTime of <time>, the text being in Dutch. Many ads are old: the age limit keeps the recent
// ones. Personal use only.

const BASE = 'https://be.talent.com';

const params = z.object({});

export function talentUrl(keyword: string, context: ConnectorContext, page: number): string {
  return `${BASE}/jobs?${query({ k: keyword, l: context.area.name, p: page })}`;
}

export function talentPage(html: string, context: ConnectorContext) {
  const $ = parsePage(html);
  const offers: RawOffer[] = [];
  const seen = new Set<string>();
  $('[data-job-id]').each((_index, element) => {
    const holder = $(element);
    const id = holder.attr('data-new-id') ?? holder.attr('data-job-id');
    // The card is inside the element, or right after it (template before 21/10/2026).
    const card = holder.is('article')
      ? holder
      : holder.find('article').first().length > 0
        ? holder.find('article').first()
        : holder.next('article');
    if (!id || card.length === 0 || seen.has(id)) return;
    seen.add(id);
    const part = (prefix: string) => card.find(`[class*="JobCard_${prefix}__"]`);
    // The snippet ends with a "read more" link: its words are not the ad's.
    const snippet = part('snippet').first().clone();
    snippet.find('a').remove();
    offers.push({
      externalId: id,
      title: textOf(part('title')),
      company: textOf(part('company')) || null,
      location: textOf(part('location')) || null,
      postedAt: normalizeDate(card.find('time').first().attr('datetime'), context),
      url: `${BASE}/view?${query({ id })}`,
      description: textOf(snippet),
    });
  });
  return { offers, read: seen.size };
}

export const talentConnector: Connector = {
  name: 'talent',
  access: 'public_page',
  family: 'keywords',
  keywordLevel: 'priority',
  personalUseOnly: true,
  titleFilter: false,
  hosts: ['be.talent.com'],
  secrets: [],
  params,
  async run(context) {
    const today = localDate(context.now, context.timeZone);
    const cutoff = context.maxAgeDays === null ? null : addDays(today, -context.maxAgeDays);
    await eachKeyword(context, async (keyword) => {
      for (let number = 1; number <= context.maxPages; number += 1) {
        const response = await context.http.getText(talentUrl(keyword, context, number));
        const page = talentPage(response.text, context);
        const recent = page.offers.filter(
          (offer) => cutoff === null || !offer.postedAt || offer.postedAt >= cutoff,
        );
        context.add(recent, page.read);
        if (page.read === 0) break;
      }
    });
  },
};
