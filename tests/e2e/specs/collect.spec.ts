import { expect, test } from '@playwright/test';
import {
  addVirtualAuthenticator,
  enrollAccount,
  expectAccessible,
  state,
  watchConsole,
} from '../helpers';

// Phase 2: an offer added by hand, the Sources screen and "test the sources", with the demo
// source standing in for the real ones (it makes no request at all).

test('adds an offer by hand, then tests the sources', async ({ page }) => {
  const problems = watchConsole(page);
  await addVirtualAuthenticator(page);
  await enrollAccount(page, state().collectLink);
  const stack = Boolean(process.env.E2E_BASE_URL);

  // The base city, read in the Belgian localities (ADR 0017): distances start from it.
  await page.getByRole('link', { name: 'Profil' }).first().click();
  const practical = page.locator('#profile-practical');
  await practical.getByLabel('Ville de base').fill('Bruxelles');
  await practical.getByLabel('Code postal').fill('1000');
  await practical.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(practical).toContainText('Ville de base trouvée : Bruxelles (1000).');
  await expect(practical.getByRole('link', { name: 'GeoNames' })).toHaveAttribute(
    'href',
    'https://www.geonames.org',
  );

  // What the scoring reads besides the profile: instructions and the grid's weights.
  const scoring = page.locator('#profile-scoring');
  await scoring.getByLabel('Consignes').fill('La comptabilité fiscale pure ne m’intéresse pas.');
  await expect(scoring).toContainText('Total : 100 sur 100.');
  await scoring.getByLabel('Compétences techniques').fill('40');
  await expect(scoring).toContainText('Total : 110 sur 100.');
  await scoring.getByRole('button', { name: 'Poids par défaut' }).click();
  await scoring.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(scoring.getByText('Enregistré.')).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('link', { name: 'Offres' }).first().click();
  await expect(page.getByRole('heading', { name: 'Offres', level: 1 })).toBeVisible();
  await expect(page.getByText("Aucune offre pour l'instant")).toBeVisible();
  await expectAccessible(page);

  // A link other than http or https is refused by the server.
  await page.getByRole('button', { name: 'Ajouter une offre' }).click();
  const form = page.locator('form');
  await form.getByLabel('Intitulé').fill('Offre piégée');
  await form.getByLabel("Lien de l'annonce").fill('javascript:alert(1)');
  await form.getByRole('button', { name: 'Ajouter' }).click();
  await expect(form.getByRole('alert')).toContainText('Certaines informations ne sont pas valides');

  // A title holding markup stays text (threat 6), the link opens apart from Job4me.
  const title = '<img src=x onerror=alert(1)> Gestionnaire de dossiers';
  await form.getByLabel('Intitulé').fill(title);
  await form.getByLabel("Lien de l'annonce").fill('https://example.org/offres/42');
  await form.getByLabel('Employeur').fill('Exemple SA');
  await form.getByLabel('Lieu').fill('Malines');
  await form.getByLabel("Texte de l'annonce").fill('Texte collé de l’annonce.');
  await form.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByRole('status')).toHaveText('Offre ajoutée.');
  const offer = page.getByRole('listitem').filter({ hasText: 'Gestionnaire de dossiers' });
  await expect(offer.getByRole('heading', { name: title })).toBeVisible();
  // Malines is Mechelen, 27 km by road from Brussels.
  await expect(offer).toContainText('Exemple SA · Mechelen, 27 km · Ajout manuel');
  // The deterministic filter: kept offers by default, the ones set aside on demand.
  await expect(page.getByRole('button', { name: 'Gardée (1)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Écartée (0)' }).click();
  await expect(
    page.getByText("Aucune offre écartée : le filtre n'a rien mis de côté."),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Gardée (1)' }).click();
  await expect(offer).toBeVisible();
  const link = offer.getByRole('link', { name: "Voir l'annonce" });
  await expect(link).toHaveAttribute('href', 'https://example.org/offres/42');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expectAccessible(page);

  // The offer's page: the announcement and its one posting, nothing to separate.
  await offer.getByRole('link', { name: title }).click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1 parution' })).toBeVisible();
  await expect(page.getByText('Texte collé de l’annonce.')).toBeVisible();
  const posting = page.getByRole('listitem').filter({ hasText: 'Ajout manuel' });
  await expect(posting.getByRole('link', { name: "Voir l'annonce" })).toHaveAttribute(
    'href',
    'https://example.org/offres/42',
  );
  await expect(page.getByRole('button', { name: "Ce n'est pas la même offre" })).toHaveCount(0);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  // « Ma note » (phase 3 plan, section 9): the reference set, rated from the offer's page.
  const rating = page.getByRole('region', { name: 'Ma note' });
  await rating.getByRole('button', { name: 'Noter cette offre' }).click();
  await rating.getByLabel('Note sur 100').fill('75');
  await rating.getByLabel('Un mot d’explication (facultatif)').fill('Bonne piste.');
  await expectAccessible(page);
  await rating.getByRole('button', { name: 'Enregistrer ma note' }).click();
  await expect(rating.getByRole('status')).toHaveText('Note enregistrée.');
  await expect(rating).toContainText('Ma note : 75');
  await expect(rating).toContainText('Bonne piste.');
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Toutes les offres' }).click();
  await expect(page.getByRole('heading', { name: 'Offres', level: 1 })).toBeVisible();

  // A priority keyword, for the demo source to read something.
  await page.getByRole('link', { name: 'Profil' }).first().click();
  const keywords = page.locator('#rubric-keywords');
  await keywords.getByRole('button', { name: 'Ajouter' }).click();
  await keywords.getByLabel('Mot-clé').fill('Comptable');
  await keywords.getByLabel('Langue').selectOption({ label: 'Français' });
  await keywords.getByLabel('Prioritaire').check();
  await keywords.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(keywords.getByRole('listitem').filter({ hasText: 'Comptable' })).toBeVisible();

  await page.getByRole('link', { name: 'Offres' }).first().click();
  await page.getByRole('main').getByRole('link', { name: 'Sources' }).click();
  await expect(page.getByRole('heading', { name: 'Sources', level: 1 })).toBeVisible();
  const demo = page.getByRole('article').filter({ hasText: 'Démonstration' });
  await expect(demo).toContainText('démonstration, sans requête · chaque jour');
  await expect(demo).toContainText('Pas encore interrogée.');
  await expect(demo).toContainText('Aucun passage planifié ou manuel sur les 28 derniers jours.');
  await expect(demo).toContainText("Pertinence sur 28 jours : aucune offre notée pour l'instant.");
  await expectAccessible(page);

  // The switch holds across a reload.
  const saved = () =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/sources/demo') && response.request().method() === 'PATCH',
    );
  await Promise.all([saved(), demo.getByLabel('Activée').uncheck()]);
  await page.reload();
  await expect(demo.getByLabel('Activée')).not.toBeChecked();
  await Promise.all([saved(), demo.getByLabel('Activée').check()]);

  await page.getByRole('button', { name: 'Tester les sources' }).click();
  const test = page.locator('section').filter({ hasText: 'Un mot-clé et une page par source' });
  if (stack) {
    // The worker runs the demo source: one keyword, one page, three offers read, none stored;
    // the third one republishes the first (ADR 0016).
    await expect(test).toContainText('Réussie', { timeout: 30_000 });
    await expect(test).toContainText('3 lues · 3 retenues · 2 inédites · 1 fusionnées');
    await expect(demo).toContainText('Réussie');
    await page.getByRole('link', { name: 'Offres' }).first().click();
    await expect(page.getByRole('listitem')).toHaveCount(1);
  } else {
    // No worker on the test server: the test waits for it.
    await expect(test).toContainText('En attente du worker…');
  }
  await expectAccessible(page);
  expect(problems).toEqual([]);
});
