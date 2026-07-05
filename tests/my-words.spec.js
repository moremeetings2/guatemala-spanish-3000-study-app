const { test, expect } = require("@playwright/test");

// My Words: the per-user custom deck. The backend is mocked via page.route with
// an in-memory store per test, so these exercise the real frontend flow —
// load on boot, add, delete, deck integration — without touching production.

function mockMyWordsApi(page, initialWords = []) {
  // In-memory store the mock mutates; tests read it to assert server effects.
  const store = { words: [...initialWords], nextId: 1 };
  page.route((url) => url.pathname.includes("/api/"), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status, body) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.endsWith("/api/my-words") && req.method() === "GET") {
      return json(200, { words: store.words, max: 500 });
    }
    if (url.pathname.endsWith("/api/my-words") && req.method() === "POST") {
      const body = JSON.parse(req.postData() || "{}");
      if (!body.es || !body.en) return json(400, { error: "Spanish text (es) is required." });
      if (store.words.some((w) => w.es.toLowerCase() === body.es.toLowerCase())) {
        return json(409, { error: `"${body.es}" is already in your My Words.` });
      }
      const word = {
        id: `mine-test-${store.nextId++}`, deck: "myWords", type: "word",
        es: body.es, en: body.en, pos: null, synonyms: [],
        sentence: body.sentence || null, createdAt: 1, updatedAt: 1,
      };
      store.words.unshift(word);
      return json(201, { word });
    }
    const deleteMatch = url.pathname.match(/\/api\/my-words\/([^/]+)$/);
    if (deleteMatch && req.method() === "DELETE") {
      const before = store.words.length;
      store.words = store.words.filter((w) => w.id !== decodeURIComponent(deleteMatch[1]));
      return before === store.words.length ? json(404, { error: "Word not found." }) : json(200, { ok: true });
    }
    // Everything else (auth/progress) succeeds blandly.
    return json(200, { cardState: {}, ok: true, saved: 0 });
  });
  return store;
}

async function boot(page, initialWords = []) {
  const store = mockMyWordsApi(page, initialWords);
  await page.addInitScript(() => {
    try {
      window.__NO_AI__ = true;
      localStorage.setItem("spanishApiBase", location.origin);
      localStorage.setItem(
        "spanishAuth.v1",
        JSON.stringify({ token: "test-token", user: { id: "u", email: "tester@example.com", role: "user" } })
      );
      if (navigator.serviceWorker) {
        navigator.serviceWorker.register = () => Promise.resolve({ update() {}, addEventListener() {} });
      }
    } catch (e) {}
  });
  await page.goto("/");
  await page.waitForFunction(() => typeof appState !== "undefined" && appState.loaded && appState.data);
  return store;
}

// Fill an add-form field by fid (form re-renders per keystroke, like auth).
async function typeField(page, fid, value) {
  await page.evaluate(({ fid, value }) => {
    const el = document.querySelector(`[data-fid="${fid}"]`);
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, { fid, value });
}

test("custom words load on boot and appear as a My Words deck everywhere", async ({ page }) => {
  await boot(page, [
    { id: "mine-1", deck: "myWords", type: "word", es: "patojo", en: "kid (Guatemalan slang)", pos: null, synonyms: [], sentence: { es: "El patojo juega.", en: "The kid plays." } },
  ]);

  // The card joined the catalog and the deck list.
  await expect.poll(() => page.evaluate(() => appState.data.CARDS.some((c) => c.id === "mine-1"))).toBe(true);
  expect(await page.evaluate(() => appState.data.DECKS.find((d) => d.id === "myWords")?.count)).toBe(1);

  // Visible in the You tab entry and the management screen.
  await page.evaluate(() => setState({ tab: "progress", route: null }));
  const content = page.locator("#content");
  await expect(content).toContainText("My Words");
  await expect(content).toContainText("1 custom word");

  await content.getByRole("button", { name: /My Words/ }).click();
  await expect(content).toContainText("patojo");
  await expect(content).toContainText("El patojo juega.");
});

test("adding a word posts to the API and puts it straight into the study rotation", async ({ page }) => {
  const store = await boot(page);

  await page.evaluate(() => setState({ route: "mywords" }));
  await typeField(page, "mw-es", "chilero");
  await typeField(page, "mw-en", "cool, great");
  await expect.poll(() => page.evaluate(() => appState.mw.es)).toBe("chilero");
  await page.locator("#content").getByRole("button", { name: "Add to My Words" }).click();

  // Server got it, list shows it, catalog carries it.
  await expect.poll(() => store.words.length).toBe(1);
  await expect(page.locator("#content")).toContainText("chilero");
  await expect.poll(() => page.evaluate(() => appState.data.CARDS.some((c) => c.es === "chilero" && c.deck === "myWords"))).toBe(true);

  // The Study button drives a filtered session containing only the custom deck.
  await page.locator("#content").getByRole("button", { name: "Study", exact: true }).click();
  await expect.poll(() => page.evaluate(() => appState.study.source)).toBe("filter");
  expect(await page.evaluate(() => appState.study.order.length)).toBe(1);
  await expect(page.locator("#content")).toContainText("chilero");
});

test("a duplicate add is rejected with the server's error", async ({ page }) => {
  await boot(page, [
    { id: "mine-1", deck: "myWords", type: "word", es: "chilero", en: "cool", pos: null, synonyms: [], sentence: null },
  ]);
  await page.evaluate(() => setState({ route: "mywords" }));
  await typeField(page, "mw-es", "chilero");
  await typeField(page, "mw-en", "cool again");
  await expect.poll(() => page.evaluate(() => appState.mw.en)).toBe("cool again");
  await page.locator("#content").getByRole("button", { name: "Add to My Words" }).click();

  await expect(page.locator("#content")).toContainText('already in your My Words');
  expect(await page.evaluate(() => appState.myWords.length)).toBe(1);
});

test("deleting a word removes it from the server, the list, and the catalog", async ({ page }) => {
  const store = await boot(page, [
    { id: "mine-1", deck: "myWords", type: "word", es: "patojo", en: "kid", pos: null, synonyms: [], sentence: null },
  ]);
  await page.evaluate(() => setState({ route: "mywords" }));
  await expect(page.locator("#content")).toContainText("patojo");

  await page.locator('#content [title="Remove from My Words"]').click();

  await expect.poll(() => store.words.length).toBe(0);
  await expect(page.locator("#content")).toContainText("No words yet");
  expect(await page.evaluate(() => appState.data.CARDS.some((c) => c.id === "mine-1"))).toBe(false);
  // Deck entry disappears when empty.
  expect(await page.evaluate(() => appState.data.DECKS.some((d) => d.id === "myWords"))).toBe(false);
});

test("logging out drops the private deck from the catalog", async ({ page }) => {
  await boot(page, [
    { id: "mine-1", deck: "myWords", type: "word", es: "patojo", en: "kid", pos: null, synonyms: [], sentence: null },
  ]);
  await expect.poll(() => page.evaluate(() => appState.data.CARDS.some((c) => c.id === "mine-1"))).toBe(true);

  await page.evaluate(() => setState({ route: "settings" }));
  await page.locator("#content").getByRole("button", { name: "Log out" }).click();

  await expect.poll(() => page.evaluate(() => appState.auth.user)).toBe(null);
  expect(await page.evaluate(() => appState.data.CARDS.some((c) => c.id === "mine-1"))).toBe(false);
  expect(await page.evaluate(() => appState.myWords.length)).toBe(0);
});
