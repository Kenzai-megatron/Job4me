import { z } from 'zod';
import { type Connector, type ConnectorContext, eachKeyword } from '../connector';
import { addDays, localDate, normalizeDate } from '../dates';
import { CollectError } from '../errors';
import { absoluteLink, parsePage, textOf } from '../html';
import type { RawOffer } from '../offer';
import { fold } from '../text';

// StepStone (docs/SOURCES.md, section 2.2): the public result pages. Probed on 23/11/2026: 25
// cards per page, `article[data-at="job-item"]` with the offer's number in its id, every field
// marked by a data-at attribute and wrapped in <style> blocks (dropped before reading). The
// search is an OR on the words: hence the title filter. Personal use only.

const BASE = 'https://www.stepstone.be';

const params = z.object({ pageSize: z.number().int().min(1).max(100) });

/** "Contrôleur de gestion" becomes "controleur-de-gestion". */
export function slug(value: string): string {
  return fold(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function stepstoneUrl(keyword: string, context: ConnectorContext, page: number): string {
  const search = `${BASE}/emplois/${slug(keyword)}/a-${slug(context.area.name)}`;
  return `${search}?radius=${context.radiusKm}&page=${page}`;
}

/** The offers of one result page, and the total the page announces (null when absent). */
export function stepstonePage(html: string, context: ConnectorContext) {
  const $ = parsePage(html);
  const total = Number($('[data-resultlist-offers-total]').attr('data-resultlist-offers-total'));
  const offers: RawOffer[] = [];
  let cards = 0;
  $('article[data-at="job-item"]').each((_index, element) => {
    cards += 1;
    const card = $(element);
    const link = card.find('a[data-at="job-item-title"]').first();
    const url = absoluteLink(link.attr('href'), BASE);
    // The number is in the card's id, and again at the end of the address.
    const id =
      card.attr('id')?.replace(/^job-item-/, '') ?? /--(\d+)-inline\.html/.exec(url ?? '')?.[1];
    if (!id || !url) return;
    const field = (name: string) => textOf(card.find(`[data-at="${name}"]`));
    offers.push({
      externalId: id,
      title: textOf(link),
      company: field('job-item-company-name') || null,
      location: field('job-item-location') || null,
      postedAt: normalizeDate(field('job-item-timeago'), context),
      url,
      salary: field('job-item-salary-info') || null,
      description: field('jobcard-content'),
      details: field('job-item-work-from-home') || null,
    });
  });
  return { offers, cards, total: Number.isFinite(total) ? total : null };
}

export const stepstoneConnector: Connector = {
  name: 'stepstone',
  access: 'public_page',
  family: 'keywords',
  keywordLevel: 'full',
  personalUseOnly: true,
  titleFilter: true,
  hosts: ['www.stepstone.be'],
  secrets: [],
  params,
  async run(context) {
    const { pageSize } = params.parse(context.params);
    const today = localDate(context.now, context.timeZone);
    const cutoff = context.maxAgeDays === null ? null : addDays(today, -context.maxAgeDays);
    await eachKeyword(context, async (keyword) => {
      for (let number = 1; number <= context.maxPages; number += 1) {
        const response = await context.http.getText(stepstoneUrl(keyword, context, number));
        const page = stepstonePage(response.text, context);
        // Neither a total nor a card: the template changed, never "0 offers" in silence.
        if (page.total === null && page.cards === 0) throw new CollectError('invalid_response');
        const recent = page.offers.filter(
          (offer) => cutoff === null || !offer.postedAt || offer.postedAt >= cutoff,
        );
        context.add(recent, page.cards);
        if (page.cards < pageSize || number * pageSize >= (page.total ?? 0)) break;
      }
    });
  },
};
