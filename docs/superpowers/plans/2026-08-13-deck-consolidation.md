# Deck Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace overlapping You-section decks with Everyday Conversation, a merged Guatemalan Lexicon, and a star-backed Most Common in Guate deck without changing canonical card IDs.

**Architecture:** Normalize source collection IDs into primary deck IDs while transforming the catalog, then route all filtering and deck counts through a shared `cardInDeck(card, deckId)` helper. Most Common in Guate is a virtual deck whose membership is computed from the current card's canonical Guatemalan Lexicon membership and `cardState.star` value.

**Tech Stack:** Vanilla JavaScript PWA, JSON study data, Playwright integration tests, GitHub Pages, Cloudflare Worker progress API.

---

### Task 1: Lock Consolidated Deck Behavior With Failing Integration Tests

**Files:**
- Modify: `tests/app.integration.spec.js`
- Modify: `tests/study-card-enrichments.spec.js`

- [ ] **Step 1: Replace the old You-deck assertions with consolidated deck assertions**

```js
test("the You tab lists the consolidated decks with their card counts", async ({ page }) => {
  await page.evaluate(() => setState({ tab: "progress", route: null }));
  const content = page.locator("#content");
  await expect(content).toContainText("Everyday Conversation");
  await expect(content).toContainText("230 cards");
  await expect(content).toContainText("Guatemalan Lexicon");
  await expect(content).toContainText("369 cards");
  await expect(content).toContainText("Most Common in Guate");
  await expect(content).not.toContainText("Coffee Phrases");
  await expect(content).not.toContainText("Guatemala Notes");
});
```

- [ ] **Step 2: Add coverage for merged source membership and starred virtual membership**

```js
test("consolidated decks preserve source cards and derive common Guate cards from stars", async ({ page }) => {
  const result = await page.evaluate(() => {
    const coffee = appState.data.CARDS.find(c => c.id.startsWith("phrase-"));
    const conversation = appState.data.CARDS.find(c => c.id.startsWith("conversation-"));
    const everyday = appState.data.CARDS.find(c => c.id.startsWith("everyday-"));
    const note = appState.data.CARDS.find(c => c.id.startsWith("bonus-"));
    const lexicon = appState.data.CARDS.find(c => c.id.startsWith("lexicon-"));
    toggleStar(lexicon.id);
    return {
      phraseDecks: [coffee.deck, conversation.deck, everyday.deck],
      noteDeck: note.deck,
      commonIds: filterCards({ deck: "mostCommonGuate" }).map(c => c.id),
      lexiconId: lexicon.id,
    };
  });
  expect(result.phraseDecks).toEqual(["everydayConversation", "everydayConversation", "everydayConversation"]);
  expect(result.noteDeck).toBe("guatemalaLexicon");
  expect(result.commonIds).toContain(result.lexiconId);
});
```

- [ ] **Step 3: Update lexicon-reference assertions from 356 to 369 and assert note text is retained**

```js
await expect(content).toContainText("369 words & phrases");
await page.evaluate(() => setState({ lexQ: "trusted people" }));
await expect(content).toContainText("Used a lot with friends, relatives, and trusted people.");
```

- [ ] **Step 4: Run the focused tests and verify RED**

Run: `npm run test:integration:headed -- --grep "consolidated|Guatemalan Lexicon"`

Expected: FAIL because the old deck definitions and counts are still rendered and `mostCommonGuate` has no membership rule.

### Task 2: Normalize Primary Decks And Add Virtual Membership

**Files:**
- Modify: `app.js:10-18`
- Modify: `app.js:188-220`
- Modify: `app.js:849-888`
- Modify: `app.js:1070-1090`
- Modify: `app.js:1190-1225`

- [ ] **Step 1: Replace overlapping source deck definitions with normalized definitions**

```js
const DECK_DEFS = {
  mainWords:             { name: 'Main 3000', short: '3000', accent: '#28b573', icon: 'dictionary' },
  everydayConversation: { name: 'Everyday Conversation', short: 'Everyday', accent: '#f5a524', icon: 'forum' },
  guatemalaLexicon:      { name: 'Guatemalan Lexicon', short: 'Lexicon', accent: '#2c7a9e', icon: 'menu_book' },
  mostCommonGuate:       { name: 'Most Common in Guate', short: 'Common GT', accent: '#e0843c', icon: 'star' },
  myWords:               { name: 'My Words', short: 'Mine', accent: '#7b64e8', icon: 'edit_note' },
};

const SOURCE_DECK_MAP = {
  coffeePhrases: 'everydayConversation',
  conversationVerbs: 'everydayConversation',
  everydayGuatemalaPhrases: 'everydayConversation',
  guatemalaBonus: 'guatemalaLexicon',
  guatemalaLexicon: 'guatemalaLexicon',
};
```

- [ ] **Step 2: Route deck filters through one membership helper**

```js
function cardInDeck(card, deckId) {
  if (deckId === 'mostCommonGuate') {
    return card.deck === 'guatemalaLexicon' && cs(card.id).star;
  }
  return card.deck === deckId;
}

// Inside filterCards:
if (f.deck && f.deck !== 'all' && !cardInDeck(c, f.deck)) return false;
```

- [ ] **Step 3: Normalize source collections without changing card IDs**

```js
Object.entries(colls).forEach(([sourceDeckId, entries]) => {
  const deckId = SOURCE_DECK_MAP[sourceDeckId] || sourceDeckId;
  entries.forEach(entry => {
    const sentence = sentenceFor(sourceDeckId, entry.spanish || '', entry, sents);
    CARDS.push({
      id: entry.id,
      es: entry.spanish || '',
      en: entry.english || '',
      deck: deckId,
      sourceDeck: sourceDeckId,
      note: entry.note || '',
      type: entry.type || 'word',
      band: entry.band || null,
      synonyms: sourceDeckId === 'mainWords' ? (syns[entry.spanish || ''] || []) : [],
      cat: sourceDeckId === 'guatemalaLexicon' ? (entry.lexiconCategory || '') : '',
      sentence,
    });
  });
});
```

- [ ] **Step 4: Keep virtual deck definitions visible and compute their counts at render time**

```js
const DECKS = Object.entries(DECK_DEFS)
  .map(([id, def]) => ({ id, ...def }))
  .filter(d => d.id !== 'myWords');

// In computeVals:
decks: DECKS.map(d => {
  const cards = CARDS.filter(c => cardInDeck(c, d.id));
  const kn = cards.filter(c => cs(c.id).state === 'known').length;
  return { ...d, count: cards.length, sub: cards.length.toLocaleString() + ' cards · ' + kn + ' known' };
}),
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `npm run test:integration:headed -- --grep "consolidated|Guatemalan Lexicon"`

Expected: PASS in Chromium and WebKit.

### Task 3: Migrate Retired Filters And Update Product Copy

**Files:**
- Modify: `app.js:180-185`
- Modify: `app.js:400-430`
- Modify: `app.js:1138-1190`
- Modify: `app.js:1360-1375`
- Modify: `README.md`
- Modify: `docs/project-status.md`
- Test: `tests/app.integration.spec.js`

- [ ] **Step 1: Add a failing persisted-filter migration test**

```js
test("retired persisted deck filters reopen in their consolidated deck", async ({ page }) => {
  await page.evaluate(key => {
    const saved = JSON.parse(localStorage.getItem(key));
    saved.browse.deck = "coffeePhrases";
    localStorage.setItem(key, JSON.stringify(saved));
  }, STORAGE_KEY);
  await page.reload();
  await waitForAppReady(page);
  expect(await page.evaluate(() => appState.browse.deck)).toBe("everydayConversation");
});
```

- [ ] **Step 2: Verify the migration test fails**

Run: `npx playwright test tests/app.integration.spec.js --grep "retired persisted" --project=chromium`

Expected: FAIL with received value `coffeePhrases`.

- [ ] **Step 3: Normalize persisted source and filter IDs**

```js
function normalizeDeckId(deckId) {
  return SOURCE_DECK_MAP[deckId] || deckId;
}

function normalizeStudySource(source) {
  if (!source || !source.startsWith('deck:')) return source;
  return 'deck:' + normalizeDeckId(source.slice(5));
}

// During boot:
browse = { ...appState.browse, ...(persisted.browse || {}) };
browse.deck = normalizeDeckId(browse.deck);
studySource = normalizeStudySource(persisted.study?.source || 'all');
quizSource = normalizeStudySource(persisted.quiz?.source || 'all');
```

- [ ] **Step 4: Update landing and documentation copy**

In the landing feature grid, replace the Coffee Phrases and Everyday Phrases cards with one card:

```js
{ title: 'Everyday Conversation', desc: 'Practical phrases for cafés, daily life, and real conversations.', icon: 'forum', tint: '#fdf1dd', ink: '#a86c11' }
```

In `README.md` and `docs/project-status.md`, state that Hablavos contains a 230-card Everyday Conversation deck, a 369-entry Guatemalan Lexicon including Guatemala Notes, and a Most Common in Guate deck derived from the signed-in user's starred lexicon cards.

- [ ] **Step 5: Run the migration test and verify GREEN**

Run: `npx playwright test tests/app.integration.spec.js --grep "retired persisted" --project=chromium`

Expected: PASS.

### Task 4: Full Verification, Live Account Validation, And Deployment

**Files:**
- Modify if required by verification: `app.js`, tests, or documentation already listed
- Do not modify: `.env`

- [ ] **Step 1: Run the full headed Playwright suite**

Run: `npm run test:integration:headed`

Expected: all integration specs pass in Chromium and WebKit.

- [ ] **Step 2: Run the full standard Playwright suite**

Run: `npx playwright test`

Expected: all specs pass in Chromium and WebKit.

- [ ] **Step 3: Validate against the real backend in a browser**

Load `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `API_BASE` from `.env` without printing them. Open the app, set `localStorage.spanishApiBase` to `API_BASE`, log in, inspect the You section, star one Guatemalan Lexicon card, verify it appears in Most Common in Guate, then un-star it and verify removal.

- [ ] **Step 4: Confirm live-test cleanup**

Fetch `/api/progress` with the admin token and confirm the tested card has `star: false`, preserving any pre-existing non-star progress fields.

- [ ] **Step 5: Commit with detailed evidence and push**

```bash
git add app.js tests/app.integration.spec.js tests/study-card-enrichments.spec.js README.md docs/project-status.md docs/superpowers/plans/2026-08-13-deck-consolidation.md
git commit -m "feat: consolidate You section decks" -m "Describe requirements, canonical-ID approach, dynamic Most Common membership, migration behavior, tests, real-backend cleanup, and live verification evidence."
git push origin main
```

- [ ] **Step 6: Verify GitHub Pages deployment**

Compare the deployed `app.js` checksum or unique updated deck label with the committed version, then exercise the deployed You and Browse flows once more.
