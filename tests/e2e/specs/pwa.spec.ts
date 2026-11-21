import { expect, test } from '@playwright/test';

// The interface installs as an app (PWA): manifest, icons, service worker, offline page.

test('serves an installable manifest with its icons', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    name: string;
    display: string;
    icons: Array<{ src: string; purpose: string }>;
  };
  expect(manifest).toMatchObject({ name: 'Job4me', display: 'standalone', start_url: '/' });
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) {
    const file = await request.get(icon.src);
    expect(file.ok()).toBe(true);
    expect(file.headers()['content-type']).toBe('image/png');
  }
});

test('registers the service worker and shows the offline page without network', async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto('/login');
  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.scope;
  });
  expect(scope).toBe(new URL('/', baseURL).href);
  // Let the new worker take control of this page, then cut the network.
  await page.reload();
  await context.setOffline(true);
  await page.goto('/settings/security');
  await expect(page.getByRole('heading', { name: 'Job4me est injoignable' })).toBeVisible();
  await context.setOffline(false);
});
