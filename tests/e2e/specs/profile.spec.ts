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
  // The list refreshes before the form closes: read the entry, not the form's options.
  const excel = skills.getByRole('listitem').filter({ hasText: 'Excel' });
  await expect(excel).toContainText('Expert');
  await expect(skills.getByRole('button', { name: 'Enregistrer' })).toBeHidden();

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
  // On the containers the extractor reads it and the worker, without a Claude key, proposes the
  // contact details only; the test server alone has neither.
  const stack = Boolean(process.env.E2E_BASE_URL);
  // The badge, not the line "1 proposition à relire".
  const step = imports.getByText(stack ? 'À relire' : 'En attente de lecture', { exact: true });
  await expect(step).toBeVisible({ timeout: 30_000 });
  if (stack) {
    await expect(imports.getByText("L'IA n'est pas configurée sur ce serveur")).toBeVisible();
  }

  await file.setInputFiles({
    name: 'cv.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('MZ'),
  });
  await send.click();
  await expect(imports.getByRole('alert')).toContainText("Ce fichier n'est pas accepté");
  await expectAccessible(page);

  // Review, on the containers: the name found in the CV, kept field by field.
  if (stack) {
    await imports.getByRole('link', { name: 'Relire les propositions' }).first().click();
    await expect(
      page.getByRole('heading', { name: "Relecture de l'import", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('Nom complet : Alex Exemple')).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Garder' }).click();
    await expect(page.getByText('Tout est relu : votre profil est à jour.')).toBeVisible();
    await page.getByRole('link', { name: '← Retour au profil' }).click();
    await expect(identity.getByLabel('Nom complet')).toHaveValue('Alex Exemple');
  }

  // Deleting the import (phase 1 review, finding 14): its file and text go, the profile keeps
  // what was accepted.
  const imported = imports.getByRole('listitem').filter({ hasText: 'CV en PDF' });
  await imported.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await imported.getByRole('button', { name: 'Supprimer définitivement' }).click();
  await expect(imports.getByText('Aucun import pour le moment.')).toBeVisible();
  if (stack) await expect(identity.getByLabel('Nom complet')).toHaveValue('Alex Exemple');

  // Keywords from the AI: a target job first, then one request queued for the worker.
  const targets = page.locator('#rubric-target-jobs');
  await targets.getByRole('button', { name: 'Ajouter' }).click();
  await targets.getByLabel('Intitulé').fill('Analyste de données');
  await targets.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(
    targets.getByRole('listitem').filter({ hasText: 'Analyste de données' }),
  ).toBeVisible();
  const keywords = page.locator('#rubric-keywords');
  await keywords.getByRole('button', { name: "Proposer avec l'IA" }).click();
  if (stack) {
    await expect(keywords.getByRole('alert')).toContainText("L'IA n'est pas configurée", {
      timeout: 30_000,
    });
  } else {
    await expect(keywords.getByRole('status')).toHaveText('Demande transmise…');
  }

  // Settings > AI: the spending against the caps, never the content of the calls.
  await page.getByRole('link', { name: 'Paramètres' }).first().click();
  await page
    .getByRole('navigation', { name: 'Pages des paramètres' })
    .getByRole('link', { name: 'IA' })
    .click();
  await expect(page.getByRole('heading', { name: 'IA', level: 1 })).toBeVisible();
  await expect(page.getByText(/Sur 7 jours : 0 \$ sur un plafond de 2 \$/)).toBeVisible();
  await expectAccessible(page);
  expect(problems).toEqual([]);
});
