import type { titleFilterLists } from '@job4me/contracts';
import { fold } from './text';

// Title filter of the profile (docs/SOURCES.md, section 1.5; phase 2 plan, section 6): three
// lists of expressions, looked for in the title without accents or case.
//
// An expression is plain text that must start a word of the title: "laborat" no longer matches
// "collaborateur", nor "pneu" "elektropneumatica", while a stem such as "logisti" still matches
// "logistique" and "logisticien". No regular expressions: a pattern typed in the profile can
// then never stall the worker (catastrophic backtracking).

export interface TitleFilterRule {
  list: (typeof titleFilterLists)[number];
  expression: string;
}

const WORD = /[\p{L}\p{N}]/u;

/** True when the folded needle starts a word of the folded title (the title filter's rule). */
export function startsAWord(title: string, needle: string): boolean {
  return matcher(needle)(title);
}

function matcher(needle: string): (title: string) => boolean {
  // ".net" or "c#" start with a sign: they may follow a letter ("asp.net").
  const atWordStart = WORD.test(needle[0]!);
  return (title) => {
    for (let from = 0; ;) {
      const index = title.indexOf(needle, from);
      if (index === -1) return false;
      if (!atWordStart || index === 0 || !WORD.test(title[index - 1]!)) return true;
      from = index + 1;
    }
  };
}

/**
 * True when a title passes: "always" wins over "reject", "reject" over "keep"; with an empty
 * "keep" list, every title not rejected passes (large at inclusion, sharp at rejection).
 */
export function compileTitleFilter(rules: readonly TitleFilterRule[]): (title: string) => boolean {
  // An expression left empty once folded is ignored, never a "keep" that nothing matches.
  const of = (list: TitleFilterRule['list']) =>
    rules
      .filter((rule) => rule.list === list)
      .map((rule) => fold(rule.expression))
      .filter((needle) => needle !== '')
      .map(matcher);
  const always = of('always');
  const reject = of('reject');
  const keep = of('keep');
  return (title) => {
    const folded = fold(title);
    if (always.some((test) => test(folded))) return true;
    if (reject.some((test) => test(folded))) return false;
    return keep.length === 0 || keep.some((test) => test(folded));
  };
}
