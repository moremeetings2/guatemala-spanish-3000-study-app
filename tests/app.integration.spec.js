const fs = require("fs");
const { devices, test, expect } = require("@playwright/test");

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

// Boot straight into the app (past the required login gate) as a signed-in user.
// Accounts are mandatory now, so we seed a session and mock the backend so the
// fake token doesn't 401 and bounce back to the landing page.
const bootAsUser = async (page, { serverCardState = {}, progressDelayMs = 0 } = {}) => {
  await page.route((url) => url.pathname.includes("/api/"), async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (progressDelayMs && request.method() === "GET" && pathname.endsWith("/api/progress")) {
      await new Promise((resolve) => setTimeout(resolve, progressDelayMs));
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cardState: serverCardState, ok: true, saved: 0 }),
    });
  });
  await page.addInitScript(() => {
    try {
      window.__NO_AI__ = true; // don't download the on-device model in tests
      localStorage.setItem("spanishApiBase", location.origin);
      localStorage.setItem(
        "spanishAuth.v1",
        JSON.stringify({ token: "test-token", user: { id: "test-user", email: "tester@example.com", role: "user" } })
      );
      // Keep the service worker from intercepting the mocked /api/ calls (WebKit).
      if (navigator.serviceWorker) {
        navigator.serviceWorker.register = () => Promise.resolve({ update() {}, addEventListener() {} });
      }
    } catch (e) {}
  });
};

test.beforeEach(async ({ page }) => {
  await bootAsUser(page);
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

test("the You tab lists the consolidated decks with their card counts", async ({ page }) => {
  await page.evaluate(() => setState({ tab: "progress", route: null }));
  const content = page.locator("#content");
  await expect(content).toContainText("3,599");            // catalog total
  await expect(content).toContainText("Main 3000");
  await expect(content).toContainText("3,000 cards");
  await expect(content).toContainText("Everyday Conversation");
  await expect(content).toContainText("230 cards");
  await expect(content).toContainText("Guatemalan Lexicon");
  await expect(content).toContainText("369 cards");
  await expect(content).toContainText("Most Common in Guate");
  await expect(content).toContainText("0 cards");
  await expect(content).not.toContainText("Coffee Phrases");
  await expect(content).not.toContainText("Guatemala Notes");
});

test("consolidated decks preserve source cards and derive common Guate cards from stars", async ({ page }) => {
  const result = await page.evaluate(() => {
    const coffee = appState.data.CARDS.find((c) => c.id.startsWith("phrase-"));
    const conversation = appState.data.CARDS.find((c) => c.id.startsWith("conversation-"));
    const everyday = appState.data.CARDS.find((c) => c.id.startsWith("everyday-"));
    const note = appState.data.CARDS.find((c) => c.id.startsWith("bonus-"));
    const lexicon = appState.data.CARDS.find((c) => c.id.startsWith("lexicon-"));
    toggleStar(lexicon.id);
    return {
      everydayCount: filterCards({ deck: "everydayConversation" }).length,
      lexiconCount: filterCards({ deck: "guatemalaLexicon" }).length,
      phraseDecks: [coffee.deck, conversation.deck, everyday.deck],
      noteDeck: note.deck,
      commonIds: filterCards({ deck: "mostCommonGuate" }).map((c) => c.id),
      lexiconId: lexicon.id,
      sharedState: appState.cardState[lexicon.id],
    };
  });

  expect(result.everydayCount).toBe(230);
  expect(result.lexiconCount).toBe(369);
  expect(result.phraseDecks).toEqual([
    "everydayConversation",
    "everydayConversation",
    "everydayConversation",
  ]);
  expect(result.noteDeck).toBe("guatemalaLexicon");
  expect(result.commonIds).toEqual([result.lexiconId]);
  expect(result.sharedState.star).toBe(true);

  await page.evaluate(() => setState({ tab: "progress", route: null }));
  await expect(page.locator("#content")).toContainText("1 card · 0 known");

  await page.evaluate(() => openBrowse({ deck: "mostCommonGuate" }));
  await expect(page.locator("#content")).toContainText("chapín / chapina");
  await page.evaluate((id) => toggleStar(id), result.lexiconId);
  await expect(page.locator("#content")).toContainText("0 cards");
  await expect(page.locator("#content")).toContainText("No cards match these filters.");
});

test("a small Most Common in Guate deck quizzes only its starred cards", async ({ page }) => {
  const lexiconId = await page.evaluate(() => {
    const card = appState.data.CARDS.find((c) => c.deck === "guatemalaLexicon");
    toggleStar(card.id);
    setState({ quiz: { ...appState.quiz, source: "deck:mostCommonGuate" } });
    buildQuiz();
    return card.id;
  });

  expect(await page.evaluate(() => appState.quiz.qs.map((q) => q.id))).toEqual([lexiconId]);
});

test("an empty Most Common in Guate deck does not fall back to an all-card quiz", async ({ page }) => {
  const result = await page.evaluate(() => {
    setState({ quiz: { ...appState.quiz, phase: "intro", source: "deck:mostCommonGuate" } });
    buildQuiz();
    return { phase: appState.quiz.phase, ids: (appState.quiz.qs || []).map((q) => q.id) };
  });

  expect(result).toEqual({ phase: "intro", ids: [] });
  await expect(page.locator("#toast-el")).toContainText("No cards match this quiz source.");
});

test("server-synced stars rebuild an active Most Common in Guate study order", async ({ browser }) => {
  const context = await browser.newContext();
  const synced = await context.newPage();
  await synced.addInitScript(() => {
    localStorage.setItem("spanishStudyApp.v1", JSON.stringify({
      study: { source: "deck:mostCommonGuate", cardId: null },
    }));
  });
  await bootAsUser(synced, {
    progressDelayMs: 500,
    serverCardState: {
      "lexicon-gt_0001": {
        state: "new", due: null, seen: false, correct: 0, wrong: 0, weak: false, star: true,
      },
    },
  });
  await synced.goto("/");
  await waitForAppReady(synced);

  await expect.poll(() => synced.evaluate(() => appState.syncing)).toBe(false);
  await expect.poll(() => synced.evaluate(() => appState.study.order)).toEqual(["lexicon-gt_0001"]);
  await context.close();
});

test("does not restore progress persisted by a different account", async ({ browser }) => {
  const context = await browser.newContext();
  const switched = await context.newPage();
  await switched.addInitScript(() => {
    localStorage.setItem("spanishStudyApp.v1", JSON.stringify({
      accountId: "previous-user",
      cardState: {
        "lexicon-gt_0001": {
          state: "known", due: null, seen: true, correct: 3, wrong: 0, weak: false, star: true,
        },
      },
    }));
  });
  await bootAsUser(switched);
  await switched.goto("/");
  await waitForAppReady(switched);

  expect(await switched.evaluate(() => appState.auth.user.id)).toBe("test-user");
  expect(await switched.evaluate(() => appState.cardState["lexicon-gt_0001"].star)).toBe(false);
  expect(await switched.evaluate(() => filterCards({ deck: "mostCommonGuate" }).length)).toBe(0);
  await context.close();
});

test("restores the signed-in account snapshot when the generic snapshot is stale", async ({ browser }) => {
  const context = await browser.newContext();
  const restored = await context.newPage();
  await restored.addInitScript(() => {
    localStorage.setItem("spanishStudyApp.v1", JSON.stringify({ accountId: null }));
    localStorage.setItem("spanishStudyApp.v1.account.test-user", JSON.stringify({
      accountId: "test-user",
      saved: [{ es: "mercado", en: "market" }],
      study: { source: "all", cardId: "main-0616" },
    }));
  });
  await bootAsUser(restored);
  await restored.goto("/");
  await waitForAppReady(restored);

  expect(await restored.evaluate(() => appState.study.order[appState.study.idx])).toBe("main-0616");
  expect(await restored.evaluate(() => appState.saved)).toEqual([{ es: "mercado", en: "market" }]);
  await context.close();
});

test("browse filters by deck and searches Spanish and English fields", async ({ page }) => {
  // Filter to the lexicon deck.
  await page.evaluate(() => openBrowse({ deck: "guatemalaLexicon" }));
  const content = page.locator("#content");
  await expect(content).toContainText("369 cards");
  await expect(content).toContainText("chapín / chapina");

  // Search narrows results (matches Spanish term + metadata).
  await page.evaluate(() => setBrowse({ q: "chapín" }));
  await expect(content).toContainText("chapín / chapina");
  await expect(content).not.toContainText("369 cards");

  // Search across the English side, across all decks.
  await page.evaluate(() => openBrowse({}));
  await page.evaluate(() => setBrowse({ q: "black coffee" }));
  await expect(content).toContainText("café negro");
});

test("retired persisted deck filters reopen in their consolidated deck", async ({ page }) => {
  await page.evaluate(() => {
    appState.browse = { ...appState.browse, deck: "coffeePhrases" };
    appState.study = { ...appState.study, source: "deck:conversationVerbs" };
    appState.quiz = { ...appState.quiz, source: "deck:guatemalaBonus" };
    saveState();
  });
  await expect.poll(async () => {
    const saved = await readIdbState(page);
    return [saved?.browse?.deck, saved?.study?.source, saved?.quiz?.source];
  }).toEqual(["coffeePhrases", "deck:conversationVerbs", "deck:guatemalaBonus"]);

  await page.reload();
  await waitForAppReady(page);

  expect(await page.evaluate(() => ({
    browse: appState.browse.deck,
    study: appState.study.source,
    quiz: appState.quiz.source,
  }))).toEqual({
    browse: "everydayConversation",
    study: "deck:everydayConversation",
    quiz: "deck:guatemalaLexicon",
  });
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
  await content.locator('[data-fid="study-star"]').click();

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

test("reopens the last active card after an iPhone study session is closed", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const phone = await context.newPage();
  await bootAsUser(phone);
  await phone.goto("/");
  await waitForAppReady(phone);

  const targetId = await phone.evaluate(() => {
    const card = appState.data.CARDS.find((c) => c.es === "abandonar");
    const idx = appState.study.order.indexOf(card.id);
    setState({ tab: "study", route: null, study: { ...appState.study, idx, flipped: false } });
    return card.id;
  });

  await expect.poll(() => phone.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).study?.cardId : null;
  }, STORAGE_KEY)).toBe(targetId);
  await expect.poll(async () => (await readIdbState(phone))?.study?.cardId).toBe(targetId);

  await phone.close();
  const reopened = await context.newPage();
  await bootAsUser(reopened);
  await reopened.goto("/");
  await waitForAppReady(reopened);

  expect(await reopened.evaluate(() => appState.study.order[appState.study.idx])).toBe(targetId);
  await context.close();
});

test("persists a snapshot to both localStorage and IndexedDB", async ({ page }) => {
  await page.evaluate(() => setProg("main-0002", "learning"));
  await expect.poll(() => page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).cardState?.["main-0002"]?.state : null;
  }, STORAGE_KEY)).toBe("learning");

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

  await content.getByRole("button", { name: "Fast", exact: true }).click();
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
  await bootAsUser(cleanPage);
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
  await page.evaluate(async ({ storageKey, accountKey, oldKey, dbName, store, dbKeys }) => {
    clearTimeout(saveTimer);
    localStorage.removeItem(storageKey);
    localStorage.removeItem(accountKey);
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
        dbKeys.forEach((key) => tx.objectStore(store).delete(key));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      req.onerror = () => resolve();
    });
  }, {
    storageKey: STORAGE_KEY,
    accountKey: `${STORAGE_KEY}.account.test-user`,
    oldKey: OLD_PROGRESS_KEY,
    dbName: IDB_NAME,
    store: IDB_STORE,
    dbKeys: [IDB_KEY, "account:test-user"],
  });

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
