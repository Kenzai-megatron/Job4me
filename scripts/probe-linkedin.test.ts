import { describe, expect, it } from 'vitest';
import { linkedinFigures, overlap } from './probe-linkedin-lib';

// A fragment shaped like the guest search answer (docs/SOURCES.md, section 2.2), made up.
const card = (id: number, withCompany = true) => `
<li>
  <div class="base-card base-search-card" data-entity-urn="urn:li:jobPosting:${id}">
    <a class="base-card__full-link" href="https://be.linkedin.com/jobs/view/comptable-at-exemple-${id}?refId=x&amp;trackingId=y"></a>
    <div class="base-search-card__info">
      <h3 class="base-search-card__title"> Comptable </h3>
      ${withCompany ? '<h4 class="base-search-card__subtitle"><a href="https://be.linkedin.com/company/exemple">Exemple SA</a></h4>' : ''}
      <div class="base-search-card__metadata">
        <span class="job-search-card__location">Bruxelles, Région de Bruxelles-Capitale, Belgique</span>
        <time class="job-search-card__listdate" datetime="2026-11-20">Il y a 3 jours</time>
      </div>
    </div>
  </div>
</li>`;

describe('LinkedIn probe', () => {
  it('counts the fields of each card without keeping any of their text', () => {
    const figures = linkedinFigures(card(4100000001) + card(4100000002, false));
    expect(figures).toEqual({
      cards: 2,
      withTitle: 2,
      withCompany: 1,
      withLocation: 2,
      withDate: 2,
      withLink: 2,
      withUrn: 2,
      linkHosts: ['be.linkedin.com'],
      ids: ['4100000001', '4100000002'],
    });
    expect(JSON.stringify({ ...figures, ids: undefined })).not.toContain('Exemple');
  });

  it('measures the overlap of two pages', () => {
    expect(overlap(['1', '2', '3'], ['4', '5'])).toBe(0);
    expect(overlap(['1', '2', '3'], ['3', '4'])).toBe(1);
  });
});
