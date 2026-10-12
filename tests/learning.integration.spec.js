const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.route('**/api/**', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ cardState: {}, words: [], ok: true }),
  }));
  await page.addInitScript(() => {
    window.__NO_AI__ = true;
    localStorage.setItem('spanishApiBase', location.origin);
    if (!localStorage.getItem('spanishAuth.v1')) localStorage.setItem('spanishAuth.v1', JSON.stringify({
      token: 'learning-test', user: { id: 'learning-user', email: 'learning@example.com' },
    }));
    navigator.serviceWorker.register = () => Promise.resolve({ update() {}, addEventListener() {} });
    window.__spoken = [];
    speechSynthesis.speak = utterance => window.__spoken.push(utterance.text);
    speechSynthesis.cancel = () => {};
  });
  await page.goto('/');
  await page.waitForFunction(() => typeof appState !== 'undefined' && appState.loaded);
}

const nav = (page, name) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true });
const face = page => page.locator('[data-fid="study-face"]');

test.beforeEach(async ({ page }) => boot(page));

test('five learning sections keep words and phrases separate with unlimited practice', async ({ page }) => {
  for (const name of ['Home', 'Words', 'Phrases', 'Verbs', 'Library']) await expect(nav(page, name)).toBeVisible();
  await nav(page, 'Words').click();
  await expect(page.getByLabel('Study collection')).toHaveValue('mainWords');
  await expect(page.getByText('No daily cap', { exact: true })).toBeVisible();
  const spanish = await face(page).innerText();
  const english = await page.evaluate(() => appState.data.CARDS.find(c => c.id === appState.study.order[appState.study.idx]).en);
  await page.getByRole('button', { name: 'Show English', exact: true }).click();
  // Some words (e.g. "animal") are spelled the same in both languages.
  await expect(face(page)).toHaveText(english);
  await expect(page.getByRole('button', { name: 'Show Spanish', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Listen in Spanish', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__spoken.at(-1))).toBe(spanish);
  for (let i = 0; i < 35; i++) await page.getByRole('button', { name: 'I knew it', exact: true }).click();
  await expect(face(page)).toBeVisible();
  expect(await page.evaluate(() => appState.study.order.every(id => appState.data.CARDS.find(c => c.id === id).deck === 'mainWords'))).toBe(true);
  await nav(page, 'Phrases').click();
  await expect(page.getByLabel('Study collection')).toHaveValue('everydaySpeaking');
  expect(await page.evaluate(() => appState.study.order.length)).toBe(636);
  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  await expect(page.locator('[data-fid="practice-search"]')).toBeVisible();
  await page.locator('[data-fid="practice-search"]').fill('let me check');
  await expect(page.getByText('Déjame ver.', { exact: true })).toBeVisible();
});

test('each practice area restores its own exact card and collection after reload', async ({ page }) => {
  await nav(page, 'Words').click();
  await page.getByLabel('Study collection').selectOption('essential200');
  await page.getByRole('button', { name: 'Next card', exact: true }).click();
  const word = await face(page).innerText();
  await nav(page, 'Phrases').click();
  await page.getByRole('button', { name: 'Next card', exact: true }).click();
  const phrase = await face(page).innerText();
  await nav(page, 'Words').click();
  await expect(face(page)).toHaveText(word);
  await page.reload();
  await nav(page, 'Phrases').click();
  await expect(face(page)).toHaveText(phrase);
  await nav(page, 'Words').click();
  await expect(page.getByLabel('Study collection')).toHaveValue('essential200');
  await expect(face(page)).toHaveText(word);
});

test('country focus persists without changing shared cards and is cleared on logout', async ({ page }) => {
  await page.getByRole('button', { name: 'Country focus: Shared Spanish' }).click();
  await page.getByRole('button', { name: 'Mexico', exact: true }).click();
  await page.getByRole('button', { name: 'Use this country', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Country focus: Mexico' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Country focus: Mexico' })).toBeVisible();
  await nav(page, 'Words').click();
  expect(await page.evaluate(() => appState.study.order.length)).toBe(3000);
  await page.getByRole('button', { name: 'Account and settings' }).click();
  await page.getByRole('button', { name: /Log out/ }).click();
  await expect(page.locator('#tab-bar')).toBeEmpty();
  await expect(page.getByRole('button', { name: 'Log in', exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => appState.settings.country || 'shared')).toBe('shared');
});

test('verb lessons explain the selected tense and person and check real answers', async ({ page }) => {
  await nav(page, 'Verbs').click();
  await page.getByRole('button', { name: /Explore hablar/ }).click();
  await page.getByRole('button', { name: 'Completed past', exact: true }).click();
  await expect(page.locator('[data-fid="verb-example"]')).toHaveText('Yo hablé con Ana ayer.');
  await page.getByRole('button', { name: 'Tú', exact: true }).click();
  await expect(page.locator('[data-fid="verb-example"]')).toHaveText('Tú hablaste con Ana ayer.');
  await page.getByRole('button', { name: 'Listen to example', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__spoken.at(-1))).toBe('Tú hablaste con Ana ayer.');
  await page.getByRole('button', { name: 'hablas', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Try again' })).toBeVisible();
  await page.getByRole('button', { name: 'hablaste', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'That fits' })).toBeVisible();
  await page.getByRole('button', { name: 'All verbs', exact: true }).click();
  await page.getByRole('button', { name: /Explore poder/ }).click();
  await page.getByRole('button', { name: 'Background past', exact: true }).click();
  await expect(page.locator('[data-fid="verb-example"]')).toHaveText('Yo podía ayudar antes.');
});

test('saved cards and reading are reachable from Library; ads stay disabled', async ({ page }) => {
  const ads = [];
  page.on('request', r => { if (/doubleclick|googlesyndication|adsbygoogle/.test(r.url())) ads.push(r.url()); });
  await page.reload();
  await nav(page, 'Words').click();
  const word = await face(page).innerText();
  await page.locator('[data-fid="study-star"]').click();
  await nav(page, 'Library').click();
  await page.getByRole('button', { name: /Saved cards/ }).click();
  await expect(page.locator('.learn-list-row strong').filter({ hasText: word })).toBeVisible();
  await nav(page, 'Library').click();
  await page.getByRole('button', { name: /Read & listen/ }).click();
  await expect(page.locator('#content')).toContainText('Short stories');
  await expect(page.locator('[data-ad-slot], ins.adsbygoogle')).toHaveCount(0);
  expect(ads).toEqual([]);
});

test('focused quizzes keep their collection and rating updates real review state', async ({ page }) => {
  await nav(page, 'Phrases').click();
  const id = await page.evaluate(() => appState.study.order[appState.study.idx]);
  await page.getByRole('button', { name: 'Review again', exact: true }).click();
  expect(await page.evaluate(id => cs(id), id)).toMatchObject({ seen: true, weak: true, wrong: 1, state: 'learning' });
  await page.getByRole('button', { name: 'Quiz', exact: true }).click();
  await page.getByRole('button', { name: /Start quiz/ }).click();
  expect(await page.evaluate(() => appState.quiz.qs.every(q => cardInDeck(appState.data.CARDS.find(c => c.id === q.id), 'everydaySpeaking')))).toBe(true);
  const correct = await page.evaluate(() => { const q = appState.quiz.qs[0]; return q.options[q.answer]; });
  await page.getByRole('button', { name: correct, exact: true }).click();
  expect(await page.evaluate(() => appState.quiz.score)).toBe(1);
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await expect(page.getByLabel('Study collection')).toHaveValue('everydaySpeaking');
});

test('country and separate practice bookmarks belong to the signed-in account', async ({ page }) => {
  await page.route('**/api/auth/login', route => {
    const { email } = route.request().postDataJSON();
    const id = email.startsWith('learning@') ? 'learning-user' : 'second-user';
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ token: id, user: { id, email } }) });
  });
  const logout = async () => {
    await page.getByRole('button', { name: 'Account and settings' }).click();
    await page.getByRole('button', { name: /Log out/ }).click();
    await expect(page.locator('#tab-bar')).toBeEmpty();
  };
  const login = async email => {
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.locator('[data-fid="auth-email"]').fill(email);
    await page.locator('[data-fid="auth-password"]').fill('test-only-password');
    await page.getByRole('button', { name: /Log in/ }).click();
    await expect(nav(page, 'Words')).toBeVisible();
  };
  await page.getByRole('button', { name: 'Country focus: Shared Spanish' }).click();
  await page.getByRole('button', { name: 'Mexico', exact: true }).click();
  await page.getByRole('button', { name: 'Use this country' }).click();
  await nav(page, 'Phrases').click();
  await page.getByRole('button', { name: 'Next card' }).click();
  const phrase = await face(page).innerText();
  await logout();
  await login('second@example.com');
  await expect(page.getByRole('button', { name: 'Country focus: Shared Spanish' })).toBeVisible();
  expect(await page.evaluate(() => appState.practice)).toEqual({});
  await logout();
  await login('learning@example.com');
  await expect(page.getByRole('button', { name: 'Country focus: Mexico' })).toBeVisible();
  await nav(page, 'Phrases').click();
  await expect(face(page)).toHaveText(phrase);
});

test('mobile navigation and practice controls fit a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await nav(page, 'Phrases').click();
  await expect(page.getByRole('button', { name: 'Listen in Spanish', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const buttons = await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button').all();
  for (const button of buttons) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
});

test('keyboard focus stays on collection, country, and lesson controls after selection', async ({ page }) => {
  await nav(page, 'Words').click();
  const collection = page.getByLabel('Study collection');
  await collection.focus();
  await collection.selectOption('essential200');
  await expect(collection).toBeFocused();
  await page.getByRole('button', { name: 'Country focus: Shared Spanish' }).click();
  const mexico = page.getByRole('button', { name: 'Mexico', exact: true });
  await mexico.focus();
  await mexico.press('Space');
  await expect(mexico).toBeFocused();
  await expect(mexico).toHaveAttribute('aria-pressed', 'true');
  await nav(page, 'Verbs').click();
  await page.getByRole('button', { name: 'Explore hablar' }).click();
  const past = page.getByRole('button', { name: 'Completed past', exact: true });
  await past.focus();
  await past.press('Space');
  await expect(past).toBeFocused();
  const tu = page.getByRole('button', { name: 'Tú', exact: true });
  await tu.focus();
  await tu.press('Space');
  await expect(tu).toBeFocused();
  await expect(page.locator('[data-fid="verb-example"]')).toHaveText('Tú hablaste con Ana ayer.');
});

test('removing a saved card also removes its duplicate reading vocabulary', async ({ page }) => {
  await nav(page, 'Library').click();
  await page.getByRole('button', { name: /Read & listen/ }).click();
  await page.getByText('El agua', { exact: true }).click();
  await page.locator('#content span[data-h]').filter({ hasText: /^agua$/ }).first().click();
  await page.getByRole('button', { name: /Save to deck/ }).click();
  await page.locator('#word-sheet > div').click({ position: { x: 10, y: 10 } });
  await nav(page, 'Words').click();
  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  await page.locator('[data-fid="practice-search"]').fill('agua');
  await page.locator('.learn-list-row').filter({ has: page.getByText('agua', { exact: true }) }).getByRole('button', { name: 'Study', exact: true }).click();
  await page.locator('[data-fid="study-star"]').click();
  await nav(page, 'Library').click();
  await page.getByRole('button', { name: /Saved cards/ }).click();
  await expect(page.locator('.learn-list-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('.learn-list-row')).toHaveCount(0);
  expect(await page.evaluate(() => appState.saved.length)).toBe(0);
  await page.reload();
  await nav(page, 'Library').click();
  await page.getByRole('button', { name: /Saved cards/ }).click();
  await expect(page.locator('.learn-list-row')).toHaveCount(0);
});
