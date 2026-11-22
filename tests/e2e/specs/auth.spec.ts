import { expect, test } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import { addVirtualAuthenticator, expectAccessible, state, watchConsole } from '../helpers';

// Phase 0 end to end: enrollment link, passkey, TOTP, recovery codes, sign-in and fallback,
// on the built interface served by the real API, with its real CSP.

let recoveryCodes: string[] = [];

test.describe.configure({ mode: 'serial' });

test('enrolls with the one-time link: passkey, TOTP and recovery codes', async ({ page }) => {
  const problems = watchConsole(page);
  const authenticator = await addVirtualAuthenticator(page);
  await page.goto(state().link);
  await expect(page.getByRole('heading', { name: 'Configurer votre accès' })).toBeVisible();
  // The token leaves the address bar as soon as it is read.
  await expect(page).toHaveURL(/\/enroll$/);
  await expectAccessible(page);

  await page.getByLabel('Nom de cet appareil').fill('Chromium de test');
  await page.getByRole('button', { name: 'Créer la passkey' }).click();

  await expect(page.getByRole('heading', { name: 'Activer le code à 6 chiffres' })).toBeVisible();
  await page.getByText('Saisie manuelle de la clé').click();
  const secret = (await page.locator('details code').innerText()).replaceAll(' ', '');
  const code = new TOTP({ secret: Secret.fromBase32(secret) }).generate();
  await page.getByLabel('Code à 6 chiffres').fill(code);
  await page.getByRole('button', { name: 'Activer' }).click();

  await expect(page.getByRole('heading', { name: 'Vos codes de secours' })).toBeVisible();
  await expect(page.locator('ol li')).toHaveCount(10);
  recoveryCodes = await page.locator('ol li').allInnerTexts();
  await page.getByLabel("J'ai rangé ces codes en lieu sûr").check();
  await page.getByRole('button', { name: 'Accéder à Job4me' }).click();

  await expect(page.getByRole('heading', { name: 'Bonjour Mehdi' })).toBeVisible();

  // Same browser, same virtual authenticator: sign out, then back in with the passkey. The sign-in
  // page offers the passkey through autofill, which a person has to pick; an authenticator that
  // answers by itself would sign straight back in, so it waits while the page is checked.
  await authenticator.answerAlone(false);
  await page.getByRole('button', { name: 'Se déconnecter' }).first().click();
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Se connecter avec une passkey' }).click();
  await authenticator.answerAlone(true);
  await expect(page.getByRole('heading', { name: 'Bonjour Mehdi' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('signs in with the password and a recovery code, which then stops working', async ({
  page,
}) => {
  const { email, password } = state();
  const signInWithCode = async (code: string) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Utiliser le mot de passe de secours' }).click();
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe').fill(password);
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByLabel('Code').fill(code);
    await page.getByRole('button', { name: 'Se connecter' }).click();
  };

  await signInWithCode(recoveryCodes[0]!);
  await expect(page.getByRole('heading', { name: 'Bonjour Mehdi' })).toBeVisible();

  await page.getByRole('button', { name: 'Se déconnecter' }).first().click();
  await expect(page).toHaveURL(/\/login$/);

  await signInWithCode(recoveryCodes[0]!);
  await expect(page.getByRole('alert')).toContainText("Ce code n'est pas valide");
});

test('shows the security settings with the audit log', async ({ page }) => {
  const { email, password } = state();
  await page.goto('/login');
  await page.getByRole('button', { name: 'Utiliser le mot de passe de secours' }).click();
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('Code').fill(recoveryCodes[1]!);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Bonjour Mehdi' })).toBeVisible();

  await page.goto('/settings/security');
  await expect(page.getByRole('heading', { name: 'Sécurité', level: 1 })).toBeVisible();
  await expect(page.getByText('Chromium de test')).toBeVisible();
  await expect(page.getByText('8 codes disponibles')).toBeVisible();
  await expect(page.getByText('Code de secours utilisé').first()).toBeVisible();
  await expectAccessible(page);
});

test('keeps strangers out of the signed-in screens', async ({ page }) => {
  await page.goto('/settings/security');
  await expect(page).toHaveURL(/\/login$/);
});
