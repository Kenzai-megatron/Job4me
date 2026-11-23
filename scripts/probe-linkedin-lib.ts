import { parsePage } from '@job4me/collect';

// What `pnpm probe:linkedin` reports of one page of LinkedIn's guest search: figures only, never
// a title, an employer, a place or a link, so the report can be sent as it is.

export interface PageFigures {
  cards: number;
  withTitle: number;
  withCompany: number;
  withLocation: number;
  withDate: number;
  withLink: number;
  withUrn: number;
  /** Hosts of the offers' links (be.linkedin.com…), never the links themselves. */
  linkHosts: string[];
  /** Identifiers, to measure the overlap of two pages; not printed. */
  ids: string[];
}

export function linkedinFigures(html: string): PageFigures {
  const $ = parsePage(html);
  const figures: PageFigures = {
    cards: 0,
    withTitle: 0,
    withCompany: 0,
    withLocation: 0,
    withDate: 0,
    withLink: 0,
    withUrn: 0,
    linkHosts: [],
    ids: [],
  };
  const hosts = new Set<string>();
  $('li').each((_index, element) => {
    const card = $(element);
    figures.cards += 1;
    if (card.find('.base-search-card__title').text().trim()) figures.withTitle += 1;
    if (card.find('.base-search-card__subtitle').text().trim()) figures.withCompany += 1;
    if (card.find('.job-search-card__location').text().trim()) figures.withLocation += 1;
    if (card.find('time[datetime]').attr('datetime')) figures.withDate += 1;
    const href = card.find('a[href*="/jobs/view/"]').first().attr('href');
    const urn = card.find('[data-entity-urn]').first().attr('data-entity-urn');
    if (urn) figures.withUrn += 1;
    let id = /(\d{6,})$/.exec(urn ?? '')?.[1];
    if (href) {
      try {
        const url = new URL(href);
        figures.withLink += 1;
        hosts.add(url.hostname);
        id ??= /-(\d{6,})(?:\/|$)/.exec(url.pathname)?.[1];
      } catch {
        // Not an absolute link: not counted.
      }
    }
    if (id) figures.ids.push(id);
  });
  figures.linkHosts = [...hosts].sort();
  return figures;
}

/** How many offers two pages have in common: 0 means start=0, 10, 20 reads disjoint pages. */
export function overlap(first: string[], second: string[]): number {
  const seen = new Set(first);
  return second.filter((id) => seen.has(id)).length;
}
