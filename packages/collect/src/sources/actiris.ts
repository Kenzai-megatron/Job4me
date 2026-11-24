import { z } from 'zod';
import { type Connector, type ConnectorContext, eachKeyword } from '../connector';
import { addDays, localDate, normalizeDate } from '../dates';
import type { RawOffer } from '../offer';

// Actiris (docs/SOURCES.md, section 2.1): the JSON API of the site, without a key. Probed on
// 23/11/2026: {total, offers[]}, disjoint pages sorted newest first, no employer in the list
// since 10/10/2026, no description. The search is an OR on the words of the title, hence the
// title filter. Not a published API: reserved for personal use, like the public pages.

const ENDPOINT = 'https://www.actiris.brussels/api/Offer/GetAllOffers';
const OFFER_PAGE = 'https://www.actiris.brussels/fr/citoyens/offres-demploi/';
/** Offers relayed from the VDAB or the Forem: their employer and place are Actiris' own. */
const OTHER_REGION = '1111111111';

const params = z.object({ pageSize: z.number().int().min(1).max(100) });

const text = z.string().nullish();
const offer = z.object({
  reference: z.union([z.string(), z.number()]).transform(String),
  titreFr: text,
  titreNl: text,
  dateCreation: text,
  communeFr: text,
  communeNl: text,
  codePostal: text,
  typeContratLibelle: text,
  dureeContratLibelle: text,
  regimeTravail: text,
  numeroEntreprise: text,
});
const page = z.object({ total: z.number().int().min(0), offers: z.array(offer) });
type ActirisOffer = z.infer<typeof offer>;

function location(item: ActirisOffer, title: string): string | null {
  // Relayed offers carry Actiris' address: the place is the end of the title, if any
  // ("Comptable - Tielt-Winge"); place names keep their own hyphens.
  if (item.numeroEntreprise === OTHER_REGION) {
    const parts = title.split(' - ');
    return parts.length > 1 ? parts.at(-1)!.trim() || null : null;
  }
  const commune = item.communeFr?.trim() || item.communeNl?.trim() || '';
  const postal = item.codePostal?.trim() ?? '';
  if (commune && postal) return `${commune} (${postal})`;
  return commune || postal || null;
}

export function actirisOffer(item: ActirisOffer, context: ConnectorContext): RawOffer {
  const title = item.titreFr?.trim() || item.titreNl?.trim() || '';
  return {
    externalId: item.reference,
    title,
    // No employer in the list since 10/10/2026 (docs/SOURCES.md): unknown, never guessed.
    company: null,
    location: location(item, title),
    postedAt: normalizeDate(item.dateCreation, context),
    url: `${OFFER_PAGE}?keywords=${encodeURIComponent(item.reference)}`,
    details:
      [
        item.typeContratLibelle,
        item.dureeContratLibelle,
        item.regimeTravail === 'PT' ? 'temps partiel' : null,
      ]
        .filter((part) => part && part.trim() !== '')
        .join(' · ') || null,
    contract: item.typeContratLibelle,
  };
}

export const actirisConnector: Connector = {
  name: 'actiris',
  access: 'api',
  family: 'keywords',
  keywordLevel: 'full',
  personalUseOnly: true,
  titleFilter: true,
  hosts: ['www.actiris.brussels'],
  secrets: [],
  params,
  async run(context) {
    const { pageSize } = params.parse(context.params);
    const today = localDate(context.now, context.timeZone);
    const cutoff = context.maxAgeDays === null ? null : addDays(today, -context.maxAgeDays);
    await eachKeyword(context, async (keyword) => {
      for (let number = 1; number <= context.maxPages; number += 1) {
        // Exactly these fields: one more (employerFilter, references…) answers 400.
        const body = {
          pageOption: { page: number, from: (number - 1) * pageSize, pageSize },
          offreFilter: { texte: keyword, keywordSearchType: 'Titre', localisation: 'Tout' },
        };
        const result = await context.http.postJson(ENDPOINT, body, page);
        const offers = result.offers.map((item) => actirisOffer(item, context));
        // Ads older than the limit are mostly filled: read, counted, not kept.
        const recent = offers.filter(
          (item) => cutoff === null || !item.postedAt || item.postedAt >= cutoff,
        );
        context.add(recent, offers.length);
        // The results are not strictly sorted by date (seen live on 23/11/2026): only the total
        // and the page count end the reading, never the age of the last ad.
        if (number * pageSize >= result.total || result.offers.length < pageSize) break;
      }
    });
  },
};
