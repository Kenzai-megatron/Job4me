import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { type CDPSession, expect, type Page } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import { STATE_FILE } from './playwright.config';

// Shared by the specs: the accounts prepared by the server, a virtual authenticator, and checks
// for CSP violations and accessibility.

export interface State {
  link: string;
  email: string;
  password: string;
  /** A second account, enrolled by the profile specs. */
  profileLink: string;
  /** A third one, enrolled by the collection specs. */
  collectLink: string;
}

export const state = (): State => JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;

/** A platform authenticator with Face ID-like user verification, emulated by Chromium. */
export async function addVirtualAuthenticator(page: Page) {
  const client: CDPSession = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  /** Whether the authenticator answers by itself, as if someone touched it at once. */
  const answerAlone = (enabled: boolean) =>
    client.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled });
  return { answerAlone };
}

/** Fails the test on any CSP violation or uncaught error in the page. */
export function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|Refused to/.test(message.text())) {
      problems.push(message.text());
    }
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

export async function expectAccessible(page: Page) {
  // Colours are measured once settled: a button caught in its colour transition (just switched
  // from one variant to the other) would read as a contrast failure. Spinners turn forever:
  // only transitions are waited for.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) => !(animation instanceof CSSTransition) || animation.playState !== 'running',
      ),
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

/** Enrolls an account from its link: passkey, TOTP and recovery codes, up to the home page. */
export async function enrollAccount(page: Page, link: string) {
  await page.goto(link);
  await page.getByRole('button', { name: 'Créer la passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Activer le code à 6 chiffres' })).toBeVisible();
  await page.getByText('Saisie manuelle de la clé').click();
  const secret = (await page.locator('details code').innerText()).replaceAll(' ', '');
  await page
    .getByLabel('Code à 6 chiffres')
    .fill(new TOTP({ secret: Secret.fromBase32(secret) }).generate());
  await page.getByRole('button', { name: 'Activer' }).click();
  await expect(page.getByRole('heading', { name: 'Vos codes de secours' })).toBeVisible();
  await page.getByLabel("J'ai rangé ces codes en lieu sûr").check();
  await page.getByRole('button', { name: 'Accéder à Job4me' }).click();
  await expect(page.getByRole('heading', { name: /^Bonjour/ })).toBeVisible();
}
