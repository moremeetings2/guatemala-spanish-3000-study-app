const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ cardState: {}, words: [], ok: true }),
  }));
  await page.addInitScript(() => {
    window.__NO_AI__ = true;
    localStorage.setItem('spanishApiBase', location.origin);
    localStorage.setItem('spanishAuth.v1', JSON.stringify({
      token: 'test-token', user: { id: 'speaking-learner', email: 'speaker@example.com', role: 'user' },
    }));
    // Keep backend fixtures out of the service-worker cache; app/data/storage are real.
    navigator.serviceWorker.register = () => Promise.resolve({ update() {}, addEventListener() {} });
  });
  await page.goto('/');
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible();
});

async function openDeck(page, query) {
  await page.locator('#tab-bar').getByRole('button', { name: /You/ }).click();
  await page.getByText('Everyday Speaking', { exact: true }).click();
  if (query) await page.locator('[data-fid="browse-search"]').fill(query);
}

test('opens the complete cleaned transcript deck and reveals Spanish after English recall', async ({ page }) => {
  await openDeck(page);
  await expect(page.locator('#content')).toContainText('636 cards');
  await page.locator('[data-fid="browse-search"]').fill('Déjame ver');
  await page.getByRole('button', { name: 'Study these', exact: true }).click();
  const card = page.locator('[data-fid="study-card"]');
  await expect(card).toContainText('Let me check.');
  await expect(card).not.toContainText('Déjame ver.');
  await page.getByRole('button', { name: 'Show Spanish', exact: true }).click();
  await expect(card).toContainText('Déjame ver.');
  await expect(card).not.toContainText('Let me check.');
  await page.getByRole('button', { name: 'Show English', exact: true }).click();
  await expect(card).toContainText('Let me check.');
});

test('reverses the cards and retains direction and the exact card after reload', async ({ page }) => {
  await openDeck(page);
  await page.getByRole('button', { name: 'Study these', exact: true }).click();
  await page.getByRole('button', { name: 'Spanish first', exact: true }).click();
  await page.getByRole('button', { name: 'Next card', exact: true }).click();
  const face = page.locator('[data-fid="study-face"]');
  const spanish = await face.textContent();
  await page.getByRole('button', { name: 'Show English', exact: true }).click();
  const english = await face.textContent();
  expect(english).not.toBe(spanish);
  await page.reload();
  await page.locator('#tab-bar').getByRole('button', { name: /Study/ }).click();
  await expect(face).toHaveText(spanish);
  await expect(page.getByRole('button', { name: 'Spanish first', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Show English', exact: true }).click();
  await expect(face).toHaveText(english);
});

test('sends the Spanish answer to the real browser speech API on either face', async ({ page }) => {
  await page.getByRole('button', { name: 'settings', exact: true }).click();
  await page.getByRole('button', { name: 'Slow', exact: true }).click();
  await page.getByRole('button', { name: 'arrow_back', exact: true }).click();
  await openDeck(page, 'Déjame ver');
  await page.getByRole('button', { name: 'Study these', exact: true }).click();
  await page.evaluate(() => {
    const nativeSpeak = speechSynthesis.speak.bind(speechSynthesis);
    window.spokenAnswers = [];
    speechSynthesis.speak = utterance => {
      window.spokenAnswers.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate });
      nativeSpeak(utterance);
    };
  });
  await page.getByRole('button', { name: 'Listen in Spanish', exact: true }).click();
  await expect(page.locator('[data-fid="study-face"]')).toHaveText('Let me check.');
  await page.getByRole('button', { name: 'Show Spanish', exact: true }).click();
  await page.getByRole('button', { name: 'Listen in Spanish', exact: true }).click();
  const spoken = await page.evaluate(() => window.spokenAnswers);
  expect(spoken).toHaveLength(2);
  for (const utterance of spoken) {
    expect(utterance.text).toBe('Déjame ver.');
    expect(utterance.lang).toMatch(/^es/);
    expect(utterance.rate).toBe(0.75);
  }
});

test('keeps the English-first preference separate from existing Spanish-first decks', async ({ page }) => {
  await openDeck(page, 'Déjame ver');
  await page.getByRole('button', { name: 'Study these', exact: true }).click();
  await expect(page.locator('[data-fid="study-face"]')).toHaveText('Let me check.');
  await page.locator('#tab-bar').getByRole('button', { name: /You/ }).click();
  await page.getByText('Main 3000', { exact: true }).click();
  await page.locator('[data-fid="browse-search"]').fill('hablar');
  await page.getByRole('button', { name: 'Study these', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Spanish first', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Show English', exact: true })).toBeVisible();
});

test('includes the end of the document and corrected source translations in browse', async ({ page }) => {
  await openDeck(page, 'window seat');
  await expect(page.locator('#content')).toContainText('¿Podría por favor sentarme junto a la ventana?');
  await page.locator('[data-fid="browse-search"]').fill('Are you in line?');
  await expect(page.locator('#content')).toContainText('¿Estás en la fila?');
  await page.locator('[data-fid="browse-search"]').fill('Cats can see in the dark.');
  await expect(page.locator('#content')).toContainText('Los gatos pueden ver en la oscuridad.');
  await page.locator('[data-fid="browse-search"]').fill("I'm touched.");
  await expect(page.locator('#content')).toContainText('Estoy conmovido.');
});

test('quizzes the new deck in English with Spanish answers from the same deck', async ({ page }) => {
  await openDeck(page, 'Déjame ver');
  await page.getByRole('button', { name: 'Quiz these', exact: true }).click();
  await page.getByRole('button', { name: /Start quiz/ }).click();
  await expect(page.locator('#content')).toContainText('Let me check.');
  await page.getByRole('button', { name: 'Déjame ver.', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Déjame ver. check_circle', exact: true })).toBeVisible();
  const options = await page.evaluate(() => ({
    all: appState.quiz.qs.flatMap(q => q.options),
    deck: appState.data.CARDS.filter(c => c.deck === 'everydaySpeaking').map(c => c.es),
  }));
  expect(options.all.every(option => options.deck.includes(option))).toBe(true);
  await page.getByRole('button', { name: 'See results', exact: true }).click();
  await expect(page.locator('#content')).toContainText('1 of 1 correct');
});

test('transcript manifest has unique stable cards, no timestamps and all source prompts accounted for', async ({ request }) => {
  const response = await request.get('/data/everyday_speaking.json');
  expect(response.ok()).toBe(true);
  const { phrases, source } = await response.json();
  expect(phrases).toHaveLength(636);
  expect(new Set(phrases.map(p => p.id)).size).toBe(636);
  expect(new Set(phrases.map(p => p.es.toLocaleLowerCase())).size).toBe(636);
  expect(phrases.reduce((n, p) => n + 1 + (p.alternateEnglish || []).length, 0)).toBe(645);
  expect(source.distinctEnglishPrompts).toBe(645);
  for (const phrase of phrases) {
    expect(phrase.id).toMatch(/^speaking-\d{4}$/);
    expect(phrase.en).toBeTruthy();
    expect(phrase.es).toBeTruthy();
    expect(phrase.en + phrase.es).not.toMatch(/\(\d+:\d+\s*-\s*\d+:\d+\)|TurboScribe|Go Unlimited/);
  }
});
