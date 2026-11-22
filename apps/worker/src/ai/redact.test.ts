import { describe, expect, it } from 'vitest';
import { redactCv } from './redact';

// A fictitious CV: no real person, addresses at example.org.
const cv = [
  'Alex Exemple',
  'Analyste de données',
  'alex.exemple@example.org · +32 470 12 34 56 · 02/123.45.67',
  'linkedin.com/in/alex-exemple · https://alex.example.org/portfolio',
  'Rue de la Loi 16, 1000 Bruxelles',
  'Née le 01/02/1990 à Liège · Nationalité : belge',
  'Numéro national : 90.02.01-123.45',
  '',
  'Expérience',
  'Démo SA, Bruxelles — 09/2019 06/2021 : rapports mensuels, Excel et Power BI',
  'Démo SPRL — 2021 – aujourd’hui : réduit de 30 % le délai de clôture',
  '',
  'Références',
  'Camille Tierce, responsable chez Démo SA, camille@example.org, 0475 98 76 54',
  'Sam Contact, +33 6 12 34 56 78',
  '',
  'Langues',
  'Français (langue maternelle), néerlandais B2, anglais C1',
].join('\n');

describe('CV redaction before the AI', () => {
  const { text, found, counts } = redactCv(cv, {
    fullName: 'Alex Exemple',
    commune: 'Schaerbeek',
  });

  it('removes contact details, links, address and personal data', () => {
    for (const secret of [
      'alex.exemple@example.org',
      '470 12 34 56',
      '123.45.67',
      'linkedin.com/in',
      'alex.example.org',
      'Rue de la Loi',
      '1000 Bruxelles',
      '01/02/1990',
      'belge',
      '90.02.01-123.45',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(counts).toMatchObject({ email: 1, phone: 2, link: 2, address: 1 });
  });

  it('removes the known name, alone or in parts, whatever the accents', () => {
    expect(text).not.toMatch(/Alex|Exemple/);
    const accented = redactCv('Signé : Zoé Lemaître, à Liège', {
      fullName: 'Zoe Lemaitre',
      commune: 'Liège',
    });
    expect(accented.text).toBe('Signé : [nom], à [commune]');
  });

  it('drops the references section, third parties included', () => {
    expect(text).toContain('[références retirées]');
    for (const third of ['Camille', 'Tierce', 'Sam Contact', 'camille@', '0475', '+33']) {
      expect(text).not.toContain(third);
    }
    expect(text).toContain('Français (langue maternelle), néerlandais B2, anglais C1');
  });

  it('keeps what the profile needs: titles, employers, dates and figures', () => {
    expect(text).toContain('Analyste de données');
    expect(text).toContain('09/2019 06/2021');
    expect(text).toContain('réduit de 30 % le délai de clôture');
    expect(text).toContain('Power BI');
  });

  it('keeps what it found, to propose it to the Identity rubric without the AI', () => {
    expect(found.emails).toEqual(['alex.exemple@example.org']);
    expect(found.phones).toEqual(['+32 470 12 34 56', '02/123.45.67']);
    expect(found.names).toEqual(['Alex Exemple']);
  });

  it('does not take a job title on the first line for a name', () => {
    expect(redactCv('Data Analyst\nSQL', {}).found.names).toEqual([]);
    expect(redactCv('Développeur Web Junior\nSQL', {}).found.names).toEqual([]);
  });
});
