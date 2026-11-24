import { z } from 'zod';
import { type Connector, type ConnectorContext, eachKeyword } from '../connector';
import { addDays, localDate, normalizeDate } from '../dates';
import type { RawOffer } from '../offer';
import { titleCase } from '../text';
import { query } from './http-query';

// Forem (docs/SOURCES.md, section 2.1): open data of the ODWB, without a key, under CC BY-SA 4.0
// (the source is cited on every offer). Probed on 23/11/2026: 24 237 offers, updated daily,
// results[] with lists for places and languages, no description (one is composed from the
// fields, the languages above all). Searched around the profile's base city (ADR 0017).

const ENDPOINT =
  'https://www.odwb.be/api/explore/v2.1/catalog/datasets/offres-d-emploi-forem/records';
const FIELDS = [
  'numerooffreforem',
  'titreoffre',
  'nomemployeur',
  'lieuxtravaillocalite',
  'lieuxtravailcodepostal',
  'datedebutdiffusion',
  'url',
  'typecontrat',
  'regimetravail',
  'langues',
  'metier',
  'niveauxetudes',
  'experiencerequise',
  'source',
];

const params = z.object({ pageSize: z.number().int().min(1).max(100) });

const text = z.string().nullish();
const list = z
  .union([z.array(z.string()), z.string()])
  .nullish()
  .transform((value) => (value === null || value === undefined ? [] : [value].flat()));
const record = z.object({
  numerooffreforem: z.union([z.string(), z.number()]).transform(String),
  titreoffre: text,
  nomemployeur: text,
  lieuxtravaillocalite: list,
  lieuxtravailcodepostal: list,
  datedebutdiffusion: text,
  url: text,
  typecontrat: text,
  regimetravail: text,
  langues: list,
  metier: text,
  niveauxetudes: list,
  experiencerequise: text,
  source: text,
});
const page = z.object({ total_count: z.number().int().min(0), results: z.array(record) });
type ForemRecord = z.infer<typeof record>;

/** "L.I.P. Belgique - L.I.P. Belgique": the employer is often written twice. */
function employer(name: string | null | undefined): string | null {
  const value = name?.trim();
  if (!value) return null;
  const halves = value.split(' - ');
  return halves.length === 2 && halves[0]!.trim() === halves[1]!.trim() ? halves[0]!.trim() : value;
}

function place(item: ForemRecord): string | null {
  const towns = [...new Set(item.lieuxtravaillocalite.map((town) => titleCase(town.trim())))];
  const postal = item.lieuxtravailcodepostal[0]?.trim();
  if (towns.length === 0) return postal || null;
  return postal ? `${towns.join(', ')} (${postal})` : towns.join(', ');
}

/** The facts the scoring must see, the required languages above all, and the source cited. */
function description(item: ForemRecord): string {
  const via = item.source?.trim();
  return [
    item.metier ? `Métier : ${item.metier}.` : null,
    item.langues.length > 0 ? `Langues : ${item.langues.join(', ')}.` : null,
    item.niveauxetudes.length > 0 ? `Études : ${item.niveauxetudes.join(', ')}.` : null,
    item.experiencerequise ? `Expérience : ${item.experiencerequise}.` : null,
    `Source : Le Forem (ODWB, CC BY-SA 4.0)${via && via !== 'Via site Forem' ? `, via ${via}` : ''}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

export function foremOffer(item: ForemRecord, context: ConnectorContext): RawOffer {
  return {
    externalId: item.numerooffreforem,
    title: item.titreoffre ?? '',
    company: employer(item.nomemployeur),
    location: place(item),
    postedAt: normalizeDate(item.datedebutdiffusion, context),
    url:
      item.url ??
      `https://www.leforem.be/recherche-offres/offre-detail/${encodeURIComponent(item.numerooffreforem)}`,
    description: description(item),
    details:
      [item.typecontrat, item.regimetravail].filter((part) => part && part.trim()).join(' · ') ||
      null,
  };
}

/** The ODSQL filter: the keyword, the distance around the base city, the age of the ad. */
export function foremWhere(keyword: string, context: ConnectorContext): string {
  // Quotes and backslashes would end the ODSQL string: they go.
  const term = keyword.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const { lat, lon } = context.center;
  const parts = [
    `search("${term}")`,
    `within_distance(lieuxtravailgeo, geom'POINT(${lon} ${lat})', ${context.radiusKm}km)`,
  ];
  if (context.maxAgeDays !== null) {
    const since = addDays(localDate(context.now, context.timeZone), -context.maxAgeDays);
    parts.push(`datedebutdiffusion >= date'${since}'`);
  }
  return parts.join(' and ');
}

export const foremConnector: Connector = {
  name: 'forem',
  access: 'open_data',
  family: 'keywords',
  keywordLevel: 'full',
  personalUseOnly: false,
  titleFilter: false,
  hosts: ['www.odwb.be'],
  secrets: [],
  params,
  async run(context) {
    const { pageSize } = params.parse(context.params);
    await eachKeyword(context, async (keyword) => {
      for (let number = 0; number < context.maxPages; number += 1) {
        const url = `${ENDPOINT}?${query({
          where: foremWhere(keyword, context),
          order_by: 'datedebutdiffusion desc',
          limit: pageSize,
          offset: number * pageSize,
          select: FIELDS.join(','),
        })}`;
        const result = await context.http.getJson(url, page);
        context.add(result.results.map((item) => foremOffer(item, context)));
        if ((number + 1) * pageSize >= result.total_count || result.results.length < pageSize) {
          break;
        }
      }
    });
  },
};
