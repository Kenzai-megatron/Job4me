import { describe, expect, it } from 'vitest';
import {
  type RulePenalties,
  type RuleWeights,
  type ScoreOffer,
  scoreOffer,
  type ScoreProfile,
} from './score';

const weights: RuleWeights = {
  title: 35,
  skills: 20,
  languages: 10,
  distance: 15,
  contract: 10,
  freshness: 10,
};
const penalties: RulePenalties = { excludedSector: 20, rejectedTitle: 15 };
const profile: ScoreProfile = {
  targetJobs: ['Comptable', 'Gestionnaire de paie'],
  keywords: [
    { keyword: 'comptable', priority: true },
    { keyword: 'boekhouder', priority: false },
  ],
  skills: ['Excel', 'SAP', 'TVA', 'Winbooks'],
  languages: { fr: 'C2', nl: 'B1', en: 'B2' },
  contracts: ['permanent'],
  regimes: ['full_time'],
  radiusKm: 40,
  acceptsRemote: true,
  excludedSectors: ['Défense'],
  rejectExpressions: ['stage'],
  today: '2026-11-24',
};
const offer = (extra: Partial<ScoreOffer> = {}): ScoreOffer => ({
  title: 'Comptable (H/F/X)',
  description: 'Vous tenez la comptabilité sur Winbooks et Excel, déclarations TVA.',
  details: 'CDI · temps plein',
  placeStatus: 'found',
  distanceKm: 8,
  remote: null,
  contracts: ['permanent'],
  languages: [],
  postedOn: '2026-11-23',
  ...extra,
});
const score = (extra: Partial<ScoreOffer> = {}, other: Partial<ScoreProfile> = {}) =>
  scoreOffer(offer(extra), { ...profile, ...other }, weights, penalties);

describe('scoreOffer', () => {
  it('puts a close and fresh offer of a target job at the top', () => {
    const result = score();
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.factors).toContainEqual({
      kind: 'title',
      strength: 'target',
      match: 'Comptable',
    });
    expect(result.factors).toContainEqual({
      kind: 'skills',
      matched: ['Excel', 'TVA', 'Winbooks'],
    });
    expect(result.factors).toContainEqual({ kind: 'freshness', days: 1 });
  });

  it('keeps an off-topic offer low, whatever else it has', () => {
    const result = score({ title: 'Chauffeur poids lourd', description: 'Permis C exigé.' });
    expect(result.score).toBeLessThan(40);
    expect(result.factors[0]).toEqual({ kind: 'title', strength: 'none', match: null });
  });

  it('ranks a keyword below a target job, and a partial title below both', () => {
    const target = score({ title: 'Gestionnaire de paie' }).score;
    const keyword = score({ title: 'Boekhouder' }).score;
    const partial = score({ title: 'Gestionnaire de dossiers' }).score;
    expect(target).toBeGreaterThan(keyword);
    expect(keyword).toBeGreaterThan(partial);
  });

  it('weighs the languages asked against the profile levels', () => {
    const dutch = score({ languages: ['nl'] });
    expect(dutch.factors).toContainEqual({ kind: 'language', code: 'nl', level: 'B1' });
    const german = score({ description: 'Allemand courant exigé.' });
    expect(german.factors).toContainEqual({ kind: 'language', code: 'de', level: null });
    expect(german.score).toBeLessThan(dutch.score);
    expect(dutch.score).toBeLessThan(score().score);
  });

  it('weighs the distance, full remote work answering it', () => {
    const near = score().score;
    const edge = score({ distanceKm: 40 }).score;
    const unknown = score({ placeStatus: 'unknown', distanceKm: null }).score;
    const remote = score({ distanceKm: 90, remote: 'full' }).score;
    expect(near).toBeGreaterThan(edge);
    expect(edge).toBeLessThan(unknown);
    expect(remote).toBe(near);
  });

  it('weighs contract and working time when the source gives them', () => {
    const interim = score({ contracts: ['interim'] });
    expect(interim.factors).toContainEqual({
      kind: 'contract',
      contracts: ['interim'],
      wanted: false,
    });
    const partTime = score({ details: 'CDI · temps partiel' });
    expect(partTime.factors).toContainEqual({ kind: 'regime', regime: 'part_time', wanted: false });
    expect(interim.score).toBeLessThan(score().score);
    expect(partTime.score).toBeLessThan(score().score);
  });

  it('prefers a fresh ad', () => {
    expect(score({ postedOn: '2026-10-01' }).score).toBeLessThan(score().score);
  });

  it('lowers an excluded sector or a rejected word of the title', () => {
    const sector = score({ description: 'Une entreprise de la défense recherche un comptable.' });
    expect(sector.factors).toContainEqual({ kind: 'sector', sector: 'Défense' });
    const rejected = score({ title: 'Stage comptable' });
    expect(rejected.factors).toContainEqual({ kind: 'rejected', expression: 'stage' });
    expect(sector.score).toBeLessThan(score().score - 15);
    expect(rejected.score).toBeLessThan(score().score - 10);
  });

  it('stays neutral on skills when an offer has no description', () => {
    const bare = score({ description: '' });
    expect(bare.score).toBeGreaterThan(score({ description: 'Rien de précis.' }).score);
  });

  it('always stays between 0 and 100', () => {
    const worst = score(
      { title: 'Stage défense', description: 'Défense. Allemand exigé.', placeStatus: 'abroad' },
      { excludedSectors: ['Défense'] },
    );
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(score().score).toBeLessThanOrEqual(100);
  });
});
