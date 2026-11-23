import { fold } from './text';

// The single date normalizer of the collection (docs/SOURCES.md, section 1.1): RFC 2822, ISO with
// or without a zone, "19 sep. 2026", "24 septembre", "06-09-2026", "Posted 26 days ago", in
// French, Dutch and English. A date without a year takes the current one, or the previous one
// when it would fall in the future (an ad of 28/12 read on 03/01).

const MONTH_NAMES: Array<[number, string[]]> = [
  [1, ['janvier', 'janv', 'jan', 'januari', 'january']],
  [2, ['fevrier', 'fevr', 'fev', 'februari', 'february', 'feb']],
  [3, ['mars', 'mar', 'maart', 'mrt', 'march']],
  [4, ['avril', 'avr', 'april', 'apr']],
  [5, ['mai', 'mei', 'may']],
  [6, ['juin', 'juni', 'june', 'jun']],
  [7, ['juillet', 'juil', 'juli', 'july', 'jul']],
  [8, ['aout', 'augustus', 'august', 'aug']],
  [9, ['septembre', 'september', 'sept', 'sep']],
  [10, ['octobre', 'oktober', 'october', 'oct', 'okt']],
  [11, ['novembre', 'november', 'nov']],
  [12, ['decembre', 'december', 'dec']],
];
const MONTHS = new Map(MONTH_NAMES.flatMap(([month, names]) => names.map((name) => [name, month])));

const DAY_MS = 86_400_000;

export interface DateContext {
  now: Date;
  /** The calendar of the user, Europe/Brussels for Mehdi. */
  timeZone: string;
}

/** The calendar day (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** A calendar day moved by a number of days. */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date) + days * DAY_MS).toISOString().slice(0, 10);
}

function dayOf(year: number, month: number, date: number): string | null {
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || date < 1 || date > 31) return null;
  const value = new Date(Date.UTC(year, month - 1, date));
  // 31 February and the like.
  if (value.getUTCMonth() !== month - 1) return null;
  return value.toISOString().slice(0, 10);
}

/** A posting date cannot lie in the future; one day of margin for the time zones. */
function notFuture(day: string | null, today: string): string | null {
  return day !== null && day <= addDays(today, 1) ? day : null;
}

/** Without a year: this year, or the previous one when the day would be in the future. */
function withoutYear(month: number, date: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  const day = dayOf(year, month, date);
  if (day === null) return dayOf(year - 1, month, date);
  return day > addDays(today, 1) ? dayOf(year - 1, month, date) : day;
}

const UNIT_DAYS: Array<[RegExp, number]> = [
  [/^(minutes?|mins?|minuut|minuten|uur|uren|heures?|hours?|hrs?|h)$/, 0],
  [/^(jours?|j|days?|d|dagen|dag)$/, 1],
  [/^(semaines?|weeks?|w|weken)$/, 7],
  [/^(mois|months?|maand|maanden)$/, 30],
  [/^(ans?|annees?|years?|jaar|jaren)$/, 365],
];

function relative(amount: string, unit: string, today: string): string | null {
  const count = /^\d+$/.test(amount) ? Number(amount) : 1;
  const days = UNIT_DAYS.find(([pattern]) => pattern.test(unit))?.[1];
  if (days === undefined || count > 3650) return null;
  return addDays(today, -count * days);
}

/** Words of a source before or around the date itself. */
const PREFIX =
  /^(?:posted|published|publiee?|publie le|publiee le|mise? en ligne(?: le)?|geplaatst(?: op)?|gepubliceerd(?: op)?|date de publication|publication|depuis|active|actif|on|le|op)\s*:?\s*/;

/** A posting date as YYYY-MM-DD, or null when the text holds none that can be trusted. */
export function normalizeDate(raw: unknown, context: DateContext): string | null {
  const today = localDate(context.now, context.timeZone);
  if (typeof raw === 'number') return fromEpoch(raw, context, today);
  if (typeof raw !== 'string') return null;
  const original = raw.trim();
  if (original === '' || original.length > 80) return null;
  if (/^\d{10}$|^\d{13}$/.test(original)) return fromEpoch(Number(original), context, today);

  // ISO 8601, with or without a time and a zone.
  const iso =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(
      original,
    );
  if (iso) {
    if (iso[4] !== undefined && iso[6] !== undefined) {
      const instant = new Date(original.replace(' ', 'T'));
      if (Number.isNaN(instant.getTime())) return null;
      return notFuture(localDate(instant, context.timeZone), today);
    }
    return notFuture(dayOf(Number(iso[1]), Number(iso[2]), Number(iso[3])), today);
  }

  // RFC 2822: "Tue, 19 Nov 2026 10:00:00 GMT", "19 Nov 2026 10:00:00 +0100".
  if (
    /^(?:[a-z]{3},\s*)?\d{1,2}\s+[a-z]{3}\s+\d{4}\s+\d{2}:\d{2}(?::\d{2})?\s*(?:[+-]\d{4}|gmt|utc|ut|z)$/i.test(
      original,
    )
  ) {
    const instant = new Date(original);
    if (Number.isNaN(instant.getTime())) return null;
    return notFuture(localDate(instant, context.timeZone), today);
  }

  const text = fold(original).replace(PREFIX, '').replace(/\s+/g, ' ');

  // Day first, as in Belgium: 06-09-2026, 06/09/2026, 06.09.26.
  const numeric = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})$/.exec(text);
  if (numeric) {
    const year = numeric[3]!.length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    return notFuture(dayOf(year, Number(numeric[2]), Number(numeric[1])), today);
  }
  const yearFirst = /^(\d{4})[./](\d{1,2})[./](\d{1,2})$/.exec(text);
  if (yearFirst) {
    return notFuture(
      dayOf(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3])),
      today,
    );
  }

  if (
    /^(aujourd'?hui|today|vandaag|just posted|a l'instant|zojuist|nouveau|nieuw|new)$/.test(text)
  ) {
    return today;
  }
  if (/^(hier|yesterday|gisteren)$/.test(text)) return addDays(today, -1);
  if (/^(avant-hier|eergisteren)$/.test(text)) return addDays(today, -2);

  // "il y a 3 jours", "il y a plus de 30 jours", "26 days ago", "30+ days ago", "2 weken geleden".
  const french = /^il y a (?:plus de )?(\d+|un|une)\+? ([a-z]+)$/.exec(text);
  if (french) return relative(french[1]!, french[2]!, today);
  const english = /^(\d+|an?|one)\+? ([a-z]+) ago$/.exec(text);
  if (english) return relative(english[1]!, english[2]!, today);
  const dutch = /^(?:meer dan )?(\d+|een)\+? ([a-z]+) geleden$/.exec(text);
  if (dutch) return relative(dutch[1]!, dutch[2]!, today);

  // "19 sep. 2026", "mardi 19 novembre 2026", "1er octobre", "24 septembre", "3 okt".
  const dayMonth = /^(?:[a-z]+,? )?(\d{1,2})(?:er|e|st|nd|rd|th)? ([a-z]+)\.?,?(?: (\d{4}))?$/.exec(
    text,
  );
  if (dayMonth) return fromParts(dayMonth[3], dayMonth[2]!, dayMonth[1]!, today);
  // "September 19, 2026", "sep 19".
  const monthDay = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?,?(?: (\d{4}))?$/.exec(text);
  if (monthDay) return fromParts(monthDay[3], monthDay[1]!, monthDay[2]!, today);
  return null;
}

function fromParts(
  year: string | undefined,
  monthName: string,
  date: string,
  today: string,
): string | null {
  const month = MONTHS.get(monthName.replace(/\.$/, ''));
  if (month === undefined) return null;
  if (year === undefined) return withoutYear(month, Number(date), today);
  return notFuture(dayOf(Number(year), month, Number(date)), today);
}

function fromEpoch(value: number, context: DateContext, today: string): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const instant = new Date(value < 1e12 ? value * 1000 : value);
  if (Number.isNaN(instant.getTime())) return null;
  return notFuture(localDate(instant, context.timeZone), today);
}
