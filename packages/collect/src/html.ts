import { type CheerioAPI, load } from 'cheerio/slim';
import { cleanLine } from './text';

// Reading public pages (ADR 0013): cheerio parses the markup and never runs the page's code.
// Scripts, styles and templates go before anything is read, so that no CSS block or inline
// data ends up in a title (StepStone wraps every field in <style> blocks).

/** The page as a document to query; nothing of it is ever executed. */
export function parsePage(html: string): CheerioAPI {
  const $ = load(html);
  $('script, style, noscript, template, svg').remove();
  return $;
}

/** The text of the first element matched, on one line; empty when there is none. */
export function textOf(element: { first(): { text(): string } }): string {
  return cleanLine(element.first().text());
}

/** An absolute http or https address from a link of the page, or null. */
export function absoluteLink(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** "Office Assistant Office Assistant": some aggregators write a title twice. */
export function oneHalf(title: string): string {
  const words = title.split(' ');
  if (words.length % 2 !== 0) return title;
  const half = words.length / 2;
  const first = words.slice(0, half).join(' ');
  return first === words.slice(half).join(' ') ? first : title;
}
