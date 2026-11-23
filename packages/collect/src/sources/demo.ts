import type { Connector } from '../connector';
import { localDate } from '../dates';
import { fold } from '../text';

/**
 * Development and end-to-end tests only (collect.demoSource): offers made up from the keywords,
 * under example.org, without any request. It goes through the whole chain: title filter, offers,
 * merge of a republication (the third offer of a page is the first one again, its employer
 * written with the city), log of the run.
 */
export const demoConnector: Connector = {
  name: 'demo',
  access: 'demo',
  family: 'keywords',
  keywordLevel: 'priority',
  personalUseOnly: false,
  titleFilter: true,
  hosts: [],
  secrets: [],
  run(context) {
    const day = localDate(context.now, context.timeZone);
    for (const keyword of context.keywords) {
      const slug =
        fold(keyword)
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'offre';
      for (let page = 0; page < context.maxPages; page += 1) {
        // One employer per page, never an extension of another ("Exemple" and "Exemple2").
        const employer = page === 0 ? 'Exemple' : `Exemple${page + 1}`;
        const offers = [1, 2, 3].map((rank) => {
          const number = page * 3 + rank;
          return {
            externalId: `demo-${slug}-${number}`,
            title: rank === 2 ? `${keyword} senior (démo)` : `${keyword} (démo)`,
            company: rank === 3 ? `${employer} SA Bruxelles` : `${employer} SA`,
            location: 'Bruxelles',
            postedAt: day,
            url: `https://example.org/offres/${slug}-${number}`,
            salary: null,
            description: 'Offre fictive de la source de démonstration de Job4me.',
            details: 'CDI · temps plein',
          };
        });
        context.add(offers, offers.length);
      }
    }
    return Promise.resolve();
  },
};
