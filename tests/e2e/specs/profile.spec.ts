import { expect, test } from '@playwright/test';
import {
  addVirtualAuthenticator,
  enrollAccount,
  expectAccessible,
  state,
  watchConsole,
} from '../helpers';

// Phase 1: the profile page, its completeness and its rubrics, with a second account.

test('fills the profile and follows its completeness', async ({ page }) => {
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
  expect(problems).toEqual([]);
});
