const { test, expect } = require("@playwright/test");

// Integration coverage for the study-card enrichments:
//   - Spanish synonyms shown on the Spanish (word) face of Main 3000 cards
//   - "Use" button that flips the card to an example-sentence face
//
// The current app renders with inline styles and delegated `data-h` handlers
// rather than stable ids, and exposes `appState` / `setState` / `setStudySource`
// as script globals. Tests drive the deck to a known card through those globals
// and then assert on the rendered text, exercising the real render + event path.

test.beforeEach(async ({ page }) => {
  // Boot straight into the app, past the required login gate, as a signed-in
  // user. Accounts are mandatory, so seed a session and mock the backend so the
  // fake token doesn't 401 and bounce back to the landing page.
  await page.route((url) => url.pathname.includes("/api/"), (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cardState: {}, ok: true, saved: 0 }),
    })
  );
  await page.addInitScript(() => {
    try {
      localStorage.setItem("spanishApiBase", location.origin);
      localStorage.setItem(
        "spanishAuth.v1",
        JSON.stringify({ token: "test-token", user: { id: "test-user", email: "tester@example.com", role: "user" } })
      );
      if (navigator.serviceWorker) {
        navigator.serviceWorker.register = () => Promise.resolve({ update() {}, addEventListener() {} });
      }
    } catch (e) {}
  });
  await page.goto("/");
  await page.waitForFunction(
    () => typeof appState !== "undefined" && appState.loaded && appState.data
  );
});

async function openMainWordCard(page, spanish) {
  await page.evaluate((word) => {
    const card = appState.data.CARDS.find(
      (c) => c.deck === "mainWords" && c.es === word
    );
    if (!card) throw new Error("card not found: " + word);
    if (appState.study.order.indexOf(card.id) === -1) setStudySource("all");
    const pos = appState.study.order.indexOf(card.id);
    setState({
      tab: "study",
      route: null,
      study: { ...appState.study, idx: pos, flipped: false, showSentence: false },
    });
  }, spanish);
}

test("shows tappable synonyms on the Spanish side of a Main 3000 card", async ({ page }) => {
  await openMainWordCard(page, "hablar");
  const content = page.locator("#content");

  // Label text is "Synonyms" in the DOM (uppercased only via CSS).
  await expect(content).toContainText("Synonyms");
  // "hablar" -> decir / charlar / hablar de (from data/synonyms.json)
  await expect(content).toContainText("charlar");

  // Synonyms are hidden once the card is flipped to English. Click an empty
  // region near the top of the card so the tap hits the card (flip) and not a
  // child button in the centered content.
  await content
    .locator('[data-h][style*="border-radius:28px"]')
    .click({ position: { x: 190, y: 24 } });
  await expect(content).toContainText("to talk; to speak");
  await expect(content).not.toContainText("Synonyms");
});

test('the "Use" button reveals an example sentence and the card flips back', async ({ page }) => {
  await openMainWordCard(page, "hablar");
  const content = page.locator("#content");

  const useButton = content.getByRole("button", { name: /Use/ });
  await expect(useButton).toBeVisible();
  await useButton.click();

  // Authored sentence for "hablar" from data/sentences.json.
  await expect(content).toContainText("Me gusta hablar con mis amigos.");
  await expect(content).toContainText("I like to talk with my friends.");

  // Tapping the card (empty top region) returns to the word face.
  await content
    .locator('[data-h][style*="border-radius:28px"]')
    .click({ position: { x: 190, y: 24 } });
  await expect(content).toContainText("hablar");
  await expect(content).not.toContainText("Me gusta hablar con mis amigos.");
});

test("shows an authored example sentence for a word deep in the deck", async ({ page }) => {
  // "peseta" is far down the frequency list; every Main 3000 word now has a
  // real authored sentence (with the mini-phrase kept only as a safety net).
  await page.evaluate(() => {
    const card = appState.data.CARDS.find((c) => c.deck === "mainWords" && c.es === "peseta");
    if (appState.study.order.indexOf(card.id) === -1) setStudySource("all");
    const pos = appState.study.order.indexOf(card.id);
    setState({ tab: "study", route: null, study: { ...appState.study, idx: pos, flipped: false, showSentence: false } });
  });
  const content = page.locator("#content");

  const useButton = content.getByRole("button", { name: /Use/ });
  await expect(useButton).toBeVisible();
  await useButton.click();
  await expect(content).toContainText("Example");
  await expect(content).toContainText("Mi abuela guarda una peseta vieja.");
});

test("opens the Guatemalan Lexicon from the You tab with example sentences", async ({ page }) => {
  await page.evaluate(() => setState({ tab: "progress", route: null }));
  const content = page.locator("#content");

  // Entry point card lives in the You tab.
  const entry = content.getByRole("button", { name: /Guatemalan Lexicon/ });
  await expect(entry).toBeVisible();
  await entry.click();

  // Reference view header + a known entry with its own example sentence.
  await expect(content).toContainText("356 words & phrases");
  await expect(content).toContainText("chapín / chapina");
  await expect(content).toContainText("Mi amiga es chapina y habla con mucho sabor local.");
});

test("search filters the Guatemalan Lexicon list", async ({ page }) => {
  await page.evaluate(() => setState({ route: "lexicon", lexQ: "" }));
  const content = page.locator("#content");
  await expect(content).toContainText("356 words & phrases");

  await page.evaluate(() => setState({ lexQ: "chapin" }));
  await expect(content).toContainText("of 356");
  await expect(content).toContainText("chapín / chapina");
  await expect(content).not.toContainText("356 words & phrases");
});

test("does not offer a Use button on cards without an example sentence", async ({ page }) => {
  await page.evaluate(() => {
    const card = appState.data.CARDS.find((c) => c.deck === "coffeePhrases");
    if (appState.study.order.indexOf(card.id) === -1) setStudySource("all");
    const pos = appState.study.order.indexOf(card.id);
    setState({ tab: "study", route: null, study: { ...appState.study, idx: pos, flipped: false, showSentence: false } });
  });
  const content = page.locator("#content");
  await expect(content.getByRole("button", { name: /Use/ })).toHaveCount(0);
});
