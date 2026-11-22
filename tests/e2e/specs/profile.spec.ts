import { makePdf } from '@job4me/imports/testing';
import { expect, test } from '@playwright/test';
import {
  addVirtualAuthenticator,
  enrollAccount,
  expectAccessible,
  state,
  watchConsole,
} from '../helpers';

// Phase 1: the profile page, its completeness and its rubrics, with a second account.

test('fills the profile, follows its completeness and imports a CV', async ({ page }) => {
  const problems = watchConsole(page);
  await addVirtualAuthenticator(page);
  await enrollAccount(page, state().profileLink);

  await page.getByRole('link', { name: 'Profil' }).first().click();
  await expect(page.getByRole('heading', { name: 'Profil', level: 1 })).toBeVisible();
  await expect(page.getByText('Profil complet à 0 %')).toBeVisible();
  await expectAccessible(page);

  const identity = page.locator('#profile-identity');
  await identity.getByLabel('Nom complet').fill('Prénom Nom');
  await identity.getByLabel('Adresse e-mail').fill('prenom.nom@example.org');
  await identity.getByLabel('Téléphone').fill('+32 470 12 34 56');
  await identity.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(identity.getByRole('status')).toHaveText('Enregistré.');

  const skills = page.locator('#rubric-skills');
  await skills.getByRole('button', { name: 'Ajouter' }).click();
  await skills.getByLabel('Nom').fill('Excel');
  await skills.getByLabel('Niveau').selectOption({ label: 'Expert' });
  await skills.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(skills.getByText('Excel')).toBeVisible();
  await expect(skills.getByText('Expert')).toBeVisible();

  const weights = { identity: 10, skills: 10 / 3 };
  await expect(
    page.getByText(`Profil complet à ${Math.round(weights.identity + weights.skills)} %`),
  ).toBeVisible();

  await skills.getByRole('button', { name: 'Supprimer' }).click();
  await expect(skills.getByText("Rien pour l'instant.")).toBeVisible();
  await expectAccessible(page);

  // Imports: a CV accepted, then read by the isolated extractor; a file that is not one refused.
  const imports = page.locator('#profile-imports');
  const file = imports.getByLabel('Fichier');
  const send = imports.getByRole('button', { name: 'Importer' });

  await file.setInputFiles({
    name: 'cv.pdf',
    mimeType: 'application/pdf',
    buffer: makePdf([['Alex Exemple', 'Analyste de données à Bruxelles']]),
  });
  await send.click();
  await expect(imports.getByText('Fichier reçu : la lecture commence.')).toBeVisible();
  await expect(imports.getByText('CV en PDF')).toBeVisible();
  // On the containers the isolated extractor reads it; the test server alone has no extractor.
  const expected = process.env.E2E_BASE_URL ? 'Texte lu' : 'En attente de lecture';
  await expect(imports.getByText(expected)).toBeVisible({ timeout: 30_000 });

  await file.setInputFiles({
    name: 'cv.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('MZ'),
  });
  await send.click();
  await expect(imports.getByRole('alert')).toContainText("Ce fichier n'est pas accepté");
  await expectAccessible(page);
  expect(problems).toEqual([]);
});
