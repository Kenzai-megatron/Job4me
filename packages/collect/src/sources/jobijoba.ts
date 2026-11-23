import { z } from 'zod';
import { type Connector, type ConnectorContext, eachKeyword } from '../connector';
import { normalizeDate } from '../dates';
import { absoluteLink, parsePage, textOf } from '../html';
import type { RawOffer } from '../offer';

// Jobijoba (docs/SOURCES.md, section 2.3): an aggregator, read without any city (it would tag
// every offer with the city searched). Probed on 23/11/2026: 30 `div.offer[data-id]` blocks a
// page; the keyword's first letter is capitalised by a 301 (sent that way at once). Sponsored
// ads only carry an encoded link: they are read and counted, never decoded, never kept.
// Personal use only.

const BASE = 'https://www.jobijoba.be';

const params = z.object({});

/** "comptable" is served as "Comptable"; spaces travel as "+" (form encoding). */
export function jobijobaUrl(keyword: string, page: number): string {
  const term = keyword.trim().replace(/^\p{Ll}/u, (letter) => letter.toUpperCase());
  const encoded = encodeURIComponent(term).replace(/%20/g, '+');
  return `${BASE}/emploi/offres-emploi-${encoded}.html${page > 1 ? `?page=${page}` : ''}`;
}

export function jobijobaPage(html: string, context: ConnectorContext) {
  const $ = parsePage(html);
  const offers: RawOffer[] = [];
  let read = 0;
  $('div.offer[data-id]').each((_index, element) => {
    read += 1;
    const block = $(element);
    const url = absoluteLink(block.find('a.permalink-link').first().attr('href'), BASE);
    const id = block.attr('data-id')?.replace(/^ad_/, '');
    if (!url || !id) return;
    // The features are marked by their icon: a pin for the place, a building for the employer.
    const feature = (icon: string) =>
      textOf(block.find(`.feature:has(.${icon})`).first().children().last());
    offers.push({
      externalId: id,
      title: textOf(block.find('.offer-header-title')),
      company: feature('icon-apartment') || null,
      location: feature('icon-map-marker') || null,
      postedAt: normalizeDate(textOf(block.find('.publication_date')), context),
      url,
      description: textOf(block.find('.description')),
    });
  });
  return { offers, read };
}

export const jobijobaConnector: Connector = {
  name: 'jobijoba',
  access: 'public_page',
  family: 'keywords',
  keywordLevel: 'priority',
  personalUseOnly: true,
  titleFilter: false,
  hosts: ['www.jobijoba.be'],
  secrets: [],
  params,
  async run(context) {
    await eachKeyword(context, async (keyword) => {
      for (let number = 1; number <= context.maxPages; number += 1) {
        const response = await context.http.getText(jobijobaUrl(keyword, number));
        const page = jobijobaPage(response.text, context);
        context.add(page.offers, page.read);
        if (page.read === 0) break;
      }
    });
  },
};
