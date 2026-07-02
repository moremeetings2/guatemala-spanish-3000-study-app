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

test("falls back to the mini-phrase for words beyond the authored set", async ({ page }) => {
  // "peseta" is deep in the deck (no authored sentence) and should fall back
  // to its mini-phrase so the Use button still works and no card is blank.
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
  // Fallback mini-phrase pairs Spanish with its English gloss.
  await expect(content).toContainText("peseta");
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
