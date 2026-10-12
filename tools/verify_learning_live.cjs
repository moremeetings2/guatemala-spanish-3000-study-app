// Explicit, headed smoke test against the real API. Never part of the mocked suite.
const { chromium, webkit, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

process.loadEnvFile(path.join(__dirname, '..', '.env'));
const origin = process.argv[2] || 'http://127.0.0.1:3400';
const engine = process.argv[3] || 'chromium';
if (!['chromium', 'webkit'].includes(engine)) throw new Error('Choose chromium or webkit');
for (const key of ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'API_BASE']) {
  if (!process.env[key]) throw new Error(`Missing ${key} in .env`);
}
const out = path.join(__dirname, '..', 'test-results', 'live-learning', new URL(origin).hostname + '-' + engine);
mkdirSync(out, { recursive: true });
const server = origin === 'http://127.0.0.1:3400'
  ? spawn('python3', ['-m', 'http.server', '3400'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' }) : null;
const touched = new Set();
let browser, context, page, token, before = {}, customId, customText, publicId;
const neutral = { state: 'new', due: null, seen: false, correct: 0, wrong: 0, weak: false, star: false };
const api = async (route, method = 'GET', data) => {
  const response = await context.request.fetch(process.env.API_BASE.replace(/\/$/, '') + route, {
    method, headers: { Authorization: 'Bearer ' + token }, data,
  });
  if (!response.ok()) throw new Error(`${method} ${route}: HTTP ${response.status()}`);
  return response.json();
};

(async () => {
  try {
    if (server) await expect.poll(async () => {
      try { return (await fetch(origin)).ok; } catch { return false; }
    }).toBe(true);
    browser = await ({ chromium, webkit })[engine].launch({ headless: false });
    context = await browser.newContext({ viewport: { width: 1280, height: 940 } });
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => {
      if (req.method() === 'PUT' && new URL(req.url()).pathname === '/api/progress') {
        Object.keys(req.postDataJSON().cardState || {}).forEach(id => touched.add(id));
      }
    });
    await page.addInitScript(base => {
      window.__NO_AI__ = true;
      localStorage.setItem('spanishApiBase', base);
    }, process.env.API_BASE);
    await page.goto(origin);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.locator('[data-fid="auth-email"]').fill(process.env.ADMIN_EMAIL);
    await page.locator('[data-fid="auth-password"]').fill(process.env.ADMIN_PASSWORD);
    await page.getByRole('button', { name: /Log in/ }).click();
    const nav = name => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true });
    await expect(nav('Home')).toBeVisible();
    await page.waitForFunction(() => !appState.syncing && appState.auth.token);
    token = await page.evaluate(() => appState.auth.token);
    expect((await api('/api/auth/me')).user.role).toBe('admin');
    before = (await api('/api/progress')).cardState;
    const shot = async name => {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(out, name + '.png'), animations: 'disabled' });
    };
    await shot('home-desktop');
    await nav('Words').click();
    await page.getByLabel('Study collection').focus();
    await page.getByLabel('Study collection').selectOption('essential200');
    await expect(page.getByLabel('Study collection')).toBeFocused();
    await page.getByRole('button', { name: 'Next card', exact: true }).click();
    const word = await page.locator('[data-fid="study-face"]').innerText();
    await nav('Phrases').click();
    await page.getByRole('button', { name: 'Next card', exact: true }).click();
    const phrase = await page.locator('[data-fid="study-face"]').innerText();
    await page.getByRole('button', { name: 'Show English', exact: true }).click();
    await page.getByRole('button', { name: 'Listen in Spanish', exact: true }).click();
    await page.getByRole('button', { name: 'Show Spanish', exact: true }).click();
    await page.reload();
    await nav('Phrases').click();
    await expect(page.locator('[data-fid="study-face"]')).toHaveText(phrase);
    await nav('Words').click();
    await expect(page.locator('[data-fid="study-face"]')).toHaveText(word);
    const ratedId = await page.evaluate(() => appState.study.order[appState.study.idx]);
    touched.add(ratedId);
    await page.getByRole('button', { name: 'I knew it', exact: true }).click();
    await expect.poll(async () => (await api('/api/progress')).cardState[ratedId]?.correct).toBe((before[ratedId]?.correct || 0) + 1);
    await page.getByRole('button', { name: 'Quiz', exact: true }).click();
    await page.getByRole('button', { name: /Start quiz/ }).click();
    const question = await page.evaluate(() => appState.quiz.qs[0]);
    touched.add(question.id);
    await page.getByRole('button', { name: question.options[question.answer], exact: true }).click();
    await expect.poll(() => page.evaluate(() => appState.quiz.score)).toBe(1);
    await nav('Verbs').click();
    await page.getByRole('button', { name: 'Explore hablar' }).click();
    await page.getByRole('button', { name: 'Completed past', exact: true }).click();
    await expect(page.locator('[data-fid="verb-example"]')).toHaveText('Yo hablé con Ana ayer.');
    await page.getByRole('button', { name: 'Listen to example' }).click();
    await shot('verb-desktop');
    await page.getByRole('button', { name: /Country focus:/ }).click();
    await page.getByRole('button', { name: 'Mexico', exact: true }).click();
    await page.getByRole('button', { name: 'Use this country' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Country focus: Mexico' })).toBeVisible();
    await page.getByRole('button', { name: 'Country focus: Mexico' }).click();
    await page.getByRole('button', { name: 'Explore local words' }).click();
    await expect(page.locator('#content')).toContainText('Mexico Lexicon');
    await nav('Library').click();
    await page.getByRole('button', { name: /My Words Your private/ }).click();
    customText = 'prueba de diseño ' + Date.now();
    await page.locator('[data-fid="mw-es"]').fill(customText);
    await page.locator('[data-fid="mw-en"]').fill('temporary design test');
    await page.getByRole('button', { name: 'Add to My Words', exact: true }).click();
    await expect(page.locator('#content')).toContainText(customText);
    customId = (await api('/api/my-words')).words.find(w => w.es === customText)?.id;
    expect(customId).toBeTruthy();
    await api('/api/my-words/' + customId, 'DELETE');
    customId = null;
    // Exercise admin CRUD with a clearly temporary, unique public record.
    publicId = 'design-check-' + Date.now();
    await api('/api/words', 'POST', { id: publicId, deck: 'mainWords', type: 'word', es: 'prueba temporal', en: 'temporary test' });
    expect((await api('/api/words/' + publicId, 'PUT', { en: 'updated temporary test' })).word.en).toBe('updated temporary test');
    await api('/api/words/' + publicId, 'DELETE');
    publicId = null;
    await nav('Library').click();
    await page.getByRole('button', { name: /Read & listen/ }).click();
    await expect(page.locator('#content')).toContainText('Short stories');
    await page.getByText('El agua', { exact: true }).click();
    await page.locator('#content span[data-h]').filter({ hasText: /^agua$/ }).first().click();
    await page.getByRole('button', { name: /Save to deck/ }).click();
    await page.locator('#word-sheet > div').click({ position: { x: 10, y: 10 } });
    await nav('Words').click();
    await page.getByRole('button', { name: 'Browse', exact: true }).click();
    await page.locator('[data-fid="practice-search"]').fill('agua');
    await page.locator('.learn-list-row').filter({ has: page.getByText('agua', { exact: true }) }).getByRole('button', { name: 'Study', exact: true }).click();
    const waterId = await page.evaluate(() => appState.study.order[appState.study.idx]);
    touched.add(waterId);
    if (!(await page.evaluate(id => cs(id).star, waterId))) await page.locator('[data-fid="study-star"]').click();
    await nav('Library').click();
    await page.getByRole('button', { name: /Saved cards/ }).click();
    const waterRow = page.locator('.learn-list-row').filter({ has: page.locator('strong').filter({ hasText: /^agua$/ }) });
    await waterRow.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(waterRow).toHaveCount(0);
    await expect.poll(async () => (await api('/api/progress')).cardState[waterId]?.star).toBe(false);
    await expect(page.locator('#toast-el')).toBeEmpty();
    await page.setViewportSize({ width: 390, height: 844 });
    for (const area of ['Home', 'Words', 'Phrases', 'Verbs', 'Library']) {
      await nav(area).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await shot(area.toLowerCase() + '-phone');
    }
    await page.getByRole('button', { name: 'Country focus: Mexico' }).click();
    await shot('countries-phone');
    expect(errors).toEqual([]);
    console.log(`${engine}: real login, separate resume, pronunciation controls, grading/sync, quiz, verb lesson, country, My Words, admin CRUD, saved-word removal, keyboard focus, reading, and phone layouts passed.`);
  } finally {
    // Restore only cards touched by this run; do not reset John's other progress.
    try { if (token && context) {
      await page?.evaluate(() => { clearTimeout(progressSyncTimer); dirtyCards.clear(); }).catch(() => {});
      // Let already-dispatched UI writes settle before restoring their originals.
      await page?.waitForTimeout(1500).catch(() => {});
      if (customText) customId = (await api('/api/my-words')).words.find(w => w.es === customText)?.id;
      if (customId) await api('/api/my-words/' + customId, 'DELETE');
      if (publicId) await api('/api/words/' + publicId, 'DELETE');
      if (touched.size) {
        const restore = Object.fromEntries([...touched].map(id => [id, before[id] || neutral]));
        await api('/api/progress', 'PUT', { cardState: restore });
        const after = (await api('/api/progress')).cardState;
        for (const id of touched) {
          for (const key of ['state', 'seen', 'correct', 'wrong', 'weak', 'star']) expect(after[id][key]).toEqual(restore[id][key]);
        }
      }
      await api('/api/auth/logout', 'POST');
      console.log('Live test data cleaned; original card progress restored.');
    } } finally {
      await browser?.close();
      server?.kill();
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
