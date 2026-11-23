import { describe, expect, it } from 'vitest';
import { compileTitleFilter, type TitleFilterRule } from './prefilter';

const rules = (keep: string[], reject: string[], always: string[] = []): TitleFilterRule[] => [
  ...keep.map((expression) => ({ list: 'keep' as const, expression })),
  ...reject.map((expression) => ({ list: 'reject' as const, expression })),
  ...always.map((expression) => ({ list: 'always' as const, expression })),
];

describe('compileTitleFilter', () => {
  it('lets every title pass without any rule', () => {
    expect(compileTitleFilter([])('Anything at all')).toBe(true);
  });

  it('keeps titles holding a "keep" expression, ignoring accents and case', () => {
    const passes = compileTitleFilter(rules(['employé administratif', 'logisti'], []));
    expect(passes('EMPLOYE ADMINISTRATIF (H/F/X)')).toBe(true);
    expect(passes('Logisticien de nuit')).toBe(true);
    expect(passes('Chauffeur poids lourd')).toBe(false);
  });

  it('rejects before keeping, and "always" wins over "reject"', () => {
    const passes = compileTitleFilter(
      rules(['employe'], ['logisti'], ['employe administratif logistique']),
    );
    expect(passes('Employé logistique')).toBe(false);
    expect(passes('Employé administratif logistique')).toBe(true);
  });

  it('only matches at the start of a word (docs/SOURCES.md, section 1.5)', () => {
    const passes = compileTitleFilter(rules([], ['laborat', 'pneu']));
    expect(passes('Collaborateur commercial')).toBe(true);
    expect(passes('Technicus elektropneumatica')).toBe(true);
    expect(passes('Laborantin')).toBe(true);
    expect(passes('Laboratoire : assistant')).toBe(false);
    expect(passes('Monteur pneus')).toBe(false);
  });

  it('lets an expression that starts with a sign follow a letter', () => {
    const passes = compileTitleFilter(rules(['.net', 'c#'], []));
    expect(passes('Développeur ASP.NET')).toBe(true);
    expect(passes('C# developer')).toBe(true);
    expect(passes('Nettoyeur')).toBe(false);
  });

  it('treats special characters as plain text, never as a pattern', () => {
    const passes = compileTitleFilter(rules(['(a+)+$', 'a.b'], []));
    expect(passes('a'.repeat(5000) + '!')).toBe(false);
    expect(passes('axb')).toBe(false);
    expect(passes('a.b inc')).toBe(true);
  });

  it('ignores empty expressions', () => {
    const passes = compileTitleFilter(rules(['  ', '\u0301'], ['']));
    expect(passes('Comptable')).toBe(true);
  });
});
