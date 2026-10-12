const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

test('the new shell and exact practice card reload when the origin server is unavailable', async ({ page, context, browserName }) => {
  const root = path.resolve(__dirname, '..');
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) throw new Error('Outside fixture root');
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const stop = () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  try {
  await page.addInitScript(() => {
    window.__NO_AI__ = true;
    localStorage.setItem('spanishAuth.v1', JSON.stringify({ token: 'offline-test', user: { id: 'offline-learner' } }));
    localStorage.setItem('spanishApiBase', location.origin);
  });
  await page.route('**/api/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ cardState: {}, words: [], ok: true }) }));
  await page.goto(origin);
  await page.waitForFunction(() => typeof appState !== 'undefined' && appState.loaded);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  for (const asset of ['learning.js', 'learning.css']) {
    expect(await page.evaluate(async asset => Boolean(await caches.match(new URL(asset, location.href))), asset)).toBe(true);
  }
  const nav = name => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true });
  await nav('Phrases').click();
  await page.getByRole('button', { name: 'Next card', exact: true }).click();
  const phrase = await page.locator('[data-fid="study-face"]').innerText();
  // WebKit's offline emulation rejects even literal service-worker responses
  // (microsoft/playwright#42775). Stop the real origin for both engines instead.
  await stop();
  await expect(fetch(origin)).rejects.toThrow();
  if (browserName === 'chromium') await context.setOffline(true);
  await page.reload();
  await nav('Phrases').click();
  await expect(page.locator('[data-fid="study-face"]')).toHaveText(phrase);
  await nav('Verbs').click();
  await page.getByRole('button', { name: 'Explore poder' }).click();
  await expect(page.locator('[data-fid="verb-example"]')).toHaveText('Yo puedo ayudar.');
  await page.getByRole('button', { name: 'Country focus: Shared Spanish' }).click();
  await page.getByRole('button', { name: 'Mexico', exact: true }).click();
  await expect(page.locator('.learn-pack')).toContainText('150 regional entries');
  } finally {
    if (server.listening) await stop();
  }
});
