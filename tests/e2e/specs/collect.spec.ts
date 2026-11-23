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
  await form.getByLabel("Texte de l'annonce").fill('Texte collé de l’annonce.');
  await form.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByRole('status')).toHaveText('Offre ajoutée.');
  const offer = page.getByRole('listitem').filter({ hasText: 'Gestionnaire de dossiers' });
  await expect(offer.getByRole('heading', { name: title })).toBeVisible();
  await expect(offer).toContainText('Exemple SA · ? · Ajout manuel');
  const link = offer.getByRole('link', { name: "Voir l'annonce" });
  await expect(link).toHaveAttribute('href', 'https://example.org/offres/42');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expectAccessible(page);

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
    // The worker runs the demo source: one keyword, one page, three offers read, none stored.
    await expect(test).toContainText('Réussie', { timeout: 30_000 });
    await expect(test).toContainText('3 lues · 3 retenues · 3 inédites');
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
