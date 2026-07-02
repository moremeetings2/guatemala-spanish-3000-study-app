const fs = require("fs");
const { test, expect } = require("@playwright/test");

// Integration coverage for the current mobile phone-style app (post-refactor).
//
// The app renders with inline styles + delegated `data-h` handlers and exposes
// `appState` / `setState` / `setStudySource` / `speak` as script globals. Tests
// drive navigation through those globals and real button clicks, then assert on
// rendered text and on the real persistence layer:
//   - localStorage key  : spanishStudyApp.v1        (single JSON blob)
//   - IndexedDB          : db "spanishApp", store "kv", key "state"
//   - legacy migration   : localStorage key guatemala-spanish-3000-progress-v2
const STORAGE_KEY = "spanishStudyApp.v1";
const OLD_PROGRESS_KEY = "guatemala-spanish-3000-progress-v2";
const IDB_NAME = "spanishApp";
const IDB_STORE = "kv";
const IDB_KEY = "state";
const SW_CACHE_NAME = extractServiceWorkerCacheName();

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await installSpeechStub(page);
});

test("home dashboard shows the catalog totals and study entry points", async ({ page }) => {
  const content = page.locator("#content");
  await expect(content).toContainText("¡Hola! 🇬🇹");
  await expect(content).toContainText("Flashcards");
  await expect(content).toContainText("Quiz");
  await expect(content).toContainText("75 stories");
  await expect(content).toContainText("3599 cards");
});

test("the You tab lists every deck with its card count", async ({ page }) => {
  await page.evaluate(() => setState({ tab: "progress", route: null }));
  const content = page.locator("#content");
  await expect(content).toContainText("3,599");            // catalog total
  await expect(content).toContainText("Main 3000");
  await expect(content).toContainText("3,000 cards");
  await expect(content).toContainText("Coffee Phrases");
  await expect(content).toContainText("57 cards");
  await expect(content).toContainText("Conversation");
  await expect(content).toContainText("73 cards");
  await expect(content).toContainText("Everyday Phrases");
  await expect(content).toContainText("100 cards");
  await expect(content).toContainText("Guatemala Notes");
  await expect(content).toContainText("13 cards");
  await expect(content).toContainText("Guatemalan Lexicon");
  await expect(content).toContainText("356 cards");
});

test("browse filters by deck and searches Spanish and English fields", async ({ page }) => {
  // Filter to the lexicon deck.
  await page.evaluate(() => openBrowse({ deck: "guatemalaLexicon" }));
  const content = page.locator("#content");
  await expect(content).toContainText("356 cards");
  await expect(content).toContainText("chapín / chapina");

  // Search narrows results (matches Spanish term + metadata).
  await page.evaluate(() => setBrowse({ q: "chapín" }));
  await expect(content).toContainText("chapín / chapina");
  await expect(content).not.toContainText("356 cards");

  // Search across the English side, across all decks.
  await page.evaluate(() => openBrowse({}));
  await page.evaluate(() => setBrowse({ q: "black coffee" }));
  await expect(content).toContainText("café negro");
});

test("study cards flip, grade, and star — and the progress persists across reload", async ({ page }) => {
  await openMainWordCard(page, "de"); // main-0001
  const content = page.locator("#content");
  await expect(content).toContainText("de");

  // Flip to English.
  await content.locator('[data-h][style*="border-radius:28px"]').click({ position: { x: 190, y: 24 } });
  await expect(content).toContainText("of; from");

  // Mark as Known and star the card.
  await content.getByRole("button", { name: "Known" }).click();
  await content.locator('[data-h][style*="border-radius:28px"] button').first().click(); // star (top-right)

  await expect
    .poll(() => page.evaluate(() => appState.cardState["main-0001"]?.state))
    .toBe("known");
  await expect
    .poll(() => page.evaluate(() => appState.cardState["main-0001"]?.star))
    .toBe(true);

  // Wait until the debounced save has actually flushed to storage, then reload.
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const card = JSON.parse(raw).cardState?.["main-0001"];
        return card ? `${card.state}:${card.star}` : null;
      }, STORAGE_KEY)
    )
    .toBe("known:true");
  await page.reload();
  await waitForAppReady(page);
  expect(await page.evaluate(() => appState.cardState["main-0001"]?.state)).toBe("known");
  expect(await page.evaluate(() => appState.cardState["main-0001"]?.star)).toBe(true);
});

test("persists a snapshot to both localStorage and IndexedDB", async ({ page }) => {
  await page.evaluate(() => setProg("main-0002", "learning"));
  await page.waitForTimeout(400);

  const local = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, STORAGE_KEY);
  expect(local?.cardState?.["main-0002"]?.state).toBe("learning");

  const idb = await readIdbState(page);
  expect(idb?.cardState?.["main-0002"]?.state).toBe("learning");
});

test("runs a full quiz to completion and updates the score", async ({ page }) => {
  await page.evaluate(() => setState({ tab: "quiz", route: null, quiz: { ...appState.quiz, phase: "intro", source: "all" } }));
  const content = page.locator("#content");

  await content.getByRole("button", { name: /Start quiz/ }).click();
  await expect.poll(() => page.evaluate(() => appState.quiz.phase)).toBe("play");

  // Answer every question with the correct option (deterministic 100%).
  for (let guard = 0; guard < 12; guard += 1) {
    const done = await page.evaluate(() => appState.quiz.phase === "done");
    if (done) break;
    await page.evaluate(() => {
      const cur = appState.quiz.qs[appState.quiz.idx];
      const answer = cur.options[cur.answer];
      const btn = [...document.querySelectorAll("#content button")].find(
        (b) => b.textContent.trim() === answer
      );
      btn.click();
    });
    await page.evaluate(() => {
      const label = appState.quiz.idx + 1 >= appState.quiz.qs.length ? "See results" : "Next question";
      const btn = [...document.querySelectorAll("#content button")].find(
        (b) => b.textContent.trim() === label
      );
      if (btn) btn.click();
    });
  }

  await expect(content).toContainText("Quiz complete!");
  await expect(content).toContainText("100%");
});

test("settings persist speed and theme and drive the pronunciation rate", async ({ page }) => {
  await page.evaluate(() => setState({ route: "settings" }));
  const content = page.locator("#content");

  await content.getByRole("button", { name: "Fast" }).click();
  await content.getByRole("button", { name: /Dark/ }).click();

  // Theme is reflected on the root element and stored in settings.
  await expect(page.locator("#screen")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => appState.settings.speed)).toBe(1.25);

  // Choosing a speed also fires a test-voice preview at the new rate.
  await expect
    .poll(() => page.evaluate(() => (window.__speech.at(-1) || {}).rate))
    .toBe(1.25);

  // Preferences survive a reload (wait for the save to flush first).
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw).settings?.theme : null;
      }, STORAGE_KEY)
    )
    .toBe("dark");
  await page.reload();
  await waitForAppReady(page);
  expect(await page.evaluate(() => appState.settings.speed)).toBe(1.25);
  expect(await page.evaluate(() => appState.settings.theme)).toBe("dark");
  await expect(page.locator("#screen")).toHaveAttribute("data-theme", "dark");
});

test("exports a JSON backup and imports it into a clean profile", async ({ browser, page }) => {
  // Create some progress to back up.
  await page.evaluate(() => {
    setProg("main-0001", "known");
    toggleStar("main-0001");
    setState({ settings: { ...appState.settings, speed: 1.25 } });
  });
  await page.waitForTimeout(200);

  await page.evaluate(() => setState({ route: "settings" }));
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#content").getByRole("button", { name: /Export progress/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("spanish-progress.json");
  const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  expect(exported.cardState["main-0001"].state).toBe("known");
  expect(exported.cardState["main-0001"].star).toBe(true);
  expect(exported.settings.speed).toBe(1.25);

  // Import the same backup into a brand-new browser context.
  const cleanContext = await browser.newContext({ acceptDownloads: true });
  const cleanPage = await cleanContext.newPage();
  await cleanPage.goto("/");
  await waitForAppReady(cleanPage);
  await installSpeechStub(cleanPage);

  await cleanPage.evaluate(() => setState({ route: "settings" }));
  await cleanPage.locator('#content input[type="file"]').setInputFiles({
    name: "spanish-progress.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported), "utf8"),
  });

  await expect(cleanPage.locator("#toast-el")).toContainText("Progress imported");
  expect(await cleanPage.evaluate(() => appState.cardState["main-0001"]?.state)).toBe("known");
  expect(await cleanPage.evaluate(() => appState.cardState["main-0001"]?.star)).toBe(true);
  expect(await cleanPage.evaluate(() => appState.settings.speed)).toBe(1.25);

  await cleanContext.close();
});

test("migrates progress saved under the legacy storage key", async ({ page }) => {
  // Clear the current stores, seed the old-format progress, then reload.
  await page.evaluate(async ({ storageKey, oldKey, dbName, store, dbKey }) => {
    localStorage.removeItem(storageKey);
    localStorage.setItem(
      oldKey,
      JSON.stringify({
        value: {
          "main-0001": { status: "known", favorite: true, quizCorrect: 2, reviewCount: 1, lastOutcome: "correct" },
        },
      })
    );
    await new Promise((resolve) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).delete(dbKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      req.onerror = () => resolve();
    });
  }, { storageKey: STORAGE_KEY, oldKey: OLD_PROGRESS_KEY, dbName: IDB_NAME, store: IDB_STORE, dbKey: IDB_KEY });

  await page.reload();
  await waitForAppReady(page);

  const migrated = await page.evaluate(() => appState.cardState["main-0001"]);
  expect(migrated.state).toBe("known");
  expect(migrated.star).toBe(true);
  expect(migrated.correct).toBe(2);
});

test("service worker serves a fresh app.js over a stale cached copy", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await waitForAppReady(page);

  const hasSW = await page.evaluate(() => "serviceWorker" in navigator);
  test.skip(!hasSW, "Service workers unavailable in this browser context");

  await ensureServiceWorkerControlsPage(page);

  // Poison the cache with a stale app.js that tags the document if it runs.
  const staleAppJs =
    'document.documentElement.dataset.cachedAppVariant = "stale-shell";\n' +
    fs.readFileSync("app.js", "utf8");
  await page.evaluate(
    async ({ cacheName, scriptText }) => {
      const cache = await caches.open(cacheName);
      await cache.put(
        new URL("./app.js", location.href).href,
        new Response(scriptText, { headers: { "Content-Type": "application/javascript" } })
      );
    },
    { cacheName: SW_CACHE_NAME, scriptText: staleAppJs }
  );

  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  await waitForAppReady(reopened);

  // network-first must win: the stale marker never appears, and the SW controls.
  await expect
    .poll(() =>
      reopened.evaluate(() => ({
        stale: document.documentElement.dataset.cachedAppVariant || null,
        controlled: Boolean(navigator.serviceWorker?.controller),
      }))
    )
    .toEqual({ stale: null, controlled: true });

  await context.close();
});

// ===== Helpers =====

async function waitForAppReady(page) {
  await page.waitForFunction(
    () =>
      typeof appState !== "undefined" &&
      appState.loaded &&
      appState.data &&
      document.querySelector("#content") &&
      document.querySelector("#content").childElementCount > 0,
    null,
    { timeout: 15000 }
  );
}

// Replace speech synthesis with a recorder so pronunciation is testable offline.
async function installSpeechStub(page) {
  await page.evaluate(() => {
    window.__speech = [];
    const stub = {
      speak: (u) =>
        window.__speech.push({
          text: u && u.text,
          rate: u && u.rate,
          voiceURI: u && u.voice ? u.voice.voiceURI : "auto",
        }),
      cancel() {},
      pause() {},
      resume() {},
      getVoices: () => [],
      onvoiceschanged: null,
    };
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: stub });
  });
}

async function openMainWordCard(page, spanish) {
  await page.evaluate((word) => {
    const card = appState.data.CARDS.find((c) => c.deck === "mainWords" && c.es === word);
    if (appState.study.order.indexOf(card.id) === -1) setStudySource("all");
    const pos = appState.study.order.indexOf(card.id);
    setState({ tab: "study", route: null, study: { ...appState.study, idx: pos, flipped: false, showSentence: false } });
  }, spanish);
}

async function readIdbState(page) {
  return page.evaluate(
    ({ dbName, store, dbKey }) =>
      new Promise((resolve) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(store, "readonly");
          const get = tx.objectStore(store).get(dbKey);
          get.onsuccess = () => resolve(get.result || null);
          get.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      }),
    { dbName: IDB_NAME, store: IDB_STORE, dbKey: IDB_KEY }
  );
}

async function ensureServiceWorkerControlsPage(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
    if (controlled) return;
    await page.reload();
    await waitForAppReady(page);
  }
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller))).toBe(true);
}

function extractServiceWorkerCacheName() {
  const source = fs.readFileSync("sw.js", "utf8");
  const match = source.match(/const CACHE_NAME = "([^"]+)"/);
  if (!match) throw new Error("Unable to determine the service worker cache name.");
  return match[1];
}
