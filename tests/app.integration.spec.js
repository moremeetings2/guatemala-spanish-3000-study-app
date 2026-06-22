const fs = require("fs");
const fsp = require("fs/promises");
const { test, expect } = require("@playwright/test");

const DB_NAME = "guatemala-spanish-study-app-db";
const DB_STORE = "appState";
const APP_JS_PATH = "app.js";
const SW_PATH = "sw.js";
const PROGRESS_STORAGE_KEY = "guatemala-spanish-3000-progress-v2";
const PREFERENCES_STORAGE_KEY = "guatemala-spanish-3000-preferences-v1";
const PERSISTENCE_SCHEMA_VERSION = 1;
const CONVERSATION_ENTRY_ID = "conversation-001-soy-nuevo-aqu";
const BASE_PROGRESS_TIMESTAMP = "2026-04-01T12:00:00.000Z";
const OLDER_TIMESTAMP = "2026-04-01T12:00:00.000Z";
const NEWER_TIMESTAMP = "2026-04-01T12:10:00.000Z";
const SERVICE_WORKER_CACHE_NAME = extractServiceWorkerCacheName();

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await installSpeechStub(page);
});

test("renders the expanded phrase content and supports search across phrasebank fields", async ({ page }) => {
  await expect(page.locator("#hero-stats")).toContainText("Coffee phrases");
  await expect(page.locator("#hero-stats")).toContainText("Conversation verbs");
  await expect(page.locator("#card-front-text")).toHaveText("de");

  await page.locator("#flashcard").click();
  await expect(page.locator("#card-back-meta")).toContainText("Phrase: de Guatemala -> from Guatemala");

  await page.locator("#search-input").fill("de Guatemala");
  await expect(page.locator("#results-summary")).toContainText("matching cards");
  await expect(page.locator("#entry-list")).toContainText("de");
  await expect(page.locator("#entry-list")).toContainText("Phrase: de Guatemala");

  await page.locator("#search-input").fill("");
  await page.locator("#deck-select").selectOption("conversationVerbs");
  await expect(page.locator("#study-summary")).toContainText("73 cards");
  await expect(page.locator("#card-front-text")).toHaveText("Soy nuevo aquí.");
  await expect(page.locator("#card-front-meta")).toContainText("Conversation verb");
  await expect(page.locator("#card-back-meta")).toContainText("Focus: ser");
});

test("loads the Guatemalan lexicon deck and searches lexicon metadata", async ({ page }) => {
  await expect(page.locator("#hero-stats")).toContainText("Guatemalan lexicon");

  await page.locator("#deck-select").selectOption("guatemalaLexicon");
  await expect(page.locator("#study-summary")).toContainText("356 cards");
  await expect(page.locator("#card-front-text")).toHaveText("chapín / chapina");
  await expect(page.locator("#card-front-meta")).toContainText("Guatemalan lexicon");
  await expect(page.locator("#card-back-meta")).toContainText("Neutral Spanish: guatemalteco; propio de Guatemala");

  await page.locator("#search-input").fill("near_unique_guatemala");
  await expect(page.locator("#results-summary")).toContainText("matching cards");
  await expect(page.locator("#entry-list")).toContainText("chapín / chapina");
  await expect(page.locator("#entry-list")).toContainText("Specificity 5/5");
});

test("loads the everyday Guatemalan phrases deck and flips Spanish cards to English", async ({ page }) => {
  await expect(page.locator("#hero-stats")).toContainText("Everyday Guatemalan phrases");

  await page.locator("#deck-select").selectOption("everydayGuatemalaPhrases");
  await expect(page.locator("#study-summary")).toContainText("100 cards");
  await expect(page.locator("#card-front-text")).toHaveText("¿Cómo va todo?");

  await page.locator("#flashcard").click();
  await expect(page.locator("#card-back-text")).toHaveText("How's it going?");

  await page.locator("#search-input").fill("Buen punto");
  await expect(page.locator("#results-summary")).toContainText("matching cards");
  await expect(page.locator("#entry-list")).toContainText("Buen punto.");
  await expect(page.locator("#entry-list")).toContainText("That's a good point.");
});

test("supports study actions and review filters", async ({ page }) => {
  await page.locator("#deck-select").selectOption("conversationVerbs");
  await expect(page.locator("#card-front-text")).toHaveText("Soy nuevo aquí.");

  await page.locator("#favorite-button").click();
  await expect(page.locator("#favorite-button")).toHaveText("Favorited");

  await page.getByRole("button", { name: "Learning" }).click();
  await expect(page.locator("#card-front-meta")).toContainText("Due now");

  await page.locator("#status-filter").selectOption("favorite");
  await expect(page.locator("#study-summary")).toContainText("1 cards");
  await expect(page.locator("#card-front-text")).toHaveText("Soy nuevo aquí.");

  await page.locator("#session-filter").selectOption("due");
  await expect(page.locator("#study-summary")).toContainText("1 cards");
  await expect(page.locator("#card-front-text")).toHaveText("Soy nuevo aquí.");

  const progressRecord = await readDatabaseRecord(page, "progress");
  expect(progressRecord.kind).toBe("progress");
  expect(progressRecord.value[CONVERSATION_ENTRY_ID].favorite).toBe(true);
  expect(progressRecord.value[CONVERSATION_ENTRY_ID].status).toBe("learning");
});

test("runs quiz interactions and pronunciation controls", async ({ page }) => {
  await page.locator("#quiz-scope").selectOption("all");
  await expect(page.locator("#quiz-prompt")).not.toHaveText(/Loading quiz/);
  await expect(page.locator("#speech-rate-input")).toHaveValue("0.68");

  const firstOption = page.locator("#quiz-options .quiz-option").first();
  const optionCount = await page.locator("#quiz-options .quiz-option").count();
  expect(optionCount).toBe(4);
  await firstOption.click();

  await expect(page.locator("#quiz-feedback")).not.toHaveText("");
  await expect(page.locator("#quiz-meta")).toContainText("Score");
  await page.locator("#speech-rate-input").evaluate((node) => {
    node.value = "0.64";
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#speech-rate-value")).toHaveText("0.64x");

  await page.locator("#speak-button").click();
  await page.locator("#quiz-speak-button").click();

  const speechCalls = await page.evaluate(() => window.__speechCalls);
  expect(speechCalls.length).toBeGreaterThanOrEqual(2);
  expect(speechCalls[0].rate).toBe(0.64);
  expect(speechCalls[0].voiceURI).toBe("auto");
});

test("persists preferences and progress across reload and supports export/import", async ({ browser, page }) => {
  await page.locator("#deck-select").selectOption("conversationVerbs");
  await page.locator("#quiz-direction").selectOption("en-es");
  await page.locator("#speech-rate-input").evaluate((node) => {
    node.value = "0.64";
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#favorite-button").click();
  await page.locator("#next-button").click();
  await page.locator("#next-button").click();
  await page.locator("#search-input").fill("primera semana");

  const resumedCardText = await page.locator("#card-front-text").textContent();

  await page.reload();
  await waitForAppReady(page);

  await expect(page.locator("#deck-select")).toHaveValue("conversationVerbs");
  await expect(page.locator("#quiz-direction")).toHaveValue("en-es");
  await expect(page.locator("#speech-rate-input")).toHaveValue("0.64");
  await expect(page.locator("#search-input")).toHaveValue("primera semana");
  await expect(page.locator("#card-front-text")).toHaveText(resumedCardText);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-progress-button").click();
  const download = await downloadPromise;
  const exportJson = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  expect(exportJson.preferences.ui.deck).toBe("conversationVerbs");
  expect(exportJson.preferences.ui.search).toBe("primera semana");
  expect(exportJson.preferences.ui.currentEntryId).toBeTruthy();
  expect(exportJson.preferences.quiz.direction).toBe("en-es");
  expect(exportJson.preferences.audio.rate).toBe(0.64);
  expect(exportJson.progress[CONVERSATION_ENTRY_ID].favorite).toBe(true);

  const importedPayload = {
    version: 3,
    exportedAt: new Date().toISOString(),
    progress: {
      "main-0001": {
        status: "known",
        favorite: true,
        reviewCount: 2,
        quizSeen: 2,
        quizCorrect: 2,
        correctStreak: 2,
        wrongCount: 0,
        intervalDays: 3,
        ease: 2.5,
        dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        lastReviewedAt: new Date().toISOString(),
        lastOutcome: "correct",
      },
    },
    preferences: {
      ui: {
        deck: "mainWords",
        session: "all",
        statusFilter: "favorite",
        band: "1K",
        type: "word",
        search: "de Guatemala",
        currentEntryId: "main-0001",
      },
      quiz: {
        scope: "all",
        direction: "es-en",
      },
      audio: {
        voiceURI: "auto",
        rate: 0.6,
      },
    },
  };

  const cleanContext = await browser.newContext({ acceptDownloads: true });
  const cleanPage = await cleanContext.newPage();
  await cleanPage.goto("/");
  await waitForAppReady(cleanPage);
  await installSpeechStub(cleanPage);

  await cleanPage.locator("#import-progress-input").setInputFiles({
    name: "import.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(importedPayload), "utf8"),
  });

  await expect(cleanPage.locator("#import-status")).toContainText("Imported 1 progress records.");
  await expect(cleanPage.locator("#deck-select")).toHaveValue("mainWords");
  await expect(cleanPage.locator("#status-filter")).toHaveValue("favorite");
  await expect(cleanPage.locator("#band-filter")).toHaveValue("1K");
  await expect(cleanPage.locator("#type-filter")).toHaveValue("word");
  await expect(cleanPage.locator("#search-input")).toHaveValue("de guatemala");
  await expect(cleanPage.locator("#speech-rate-input")).toHaveValue("0.6");
  await expect(cleanPage.locator("#card-front-text")).toHaveText("de");
  await expect(cleanPage.locator("#favorite-button")).toHaveText("Favorited");

  const importedPreferences = await readDatabaseRecord(cleanPage, "preferences");
  expect(importedPreferences.kind).toBe("preferences");
  expect(importedPreferences.value.ui.deck).toBe("mainWords");
  expect(importedPreferences.value.ui.currentEntryId).toBe("main-0001");
  expect(importedPreferences.value.quiz.scope).toBe("all");
  expect(importedPreferences.value.audio.rate).toBe(0.6);

  await cleanContext.close();
});

test("persists study progress across a full relaunch", async ({ playwright, browserName, baseURL }, testInfo) => {
  const userDataDir = testInfo.outputPath(`persistent-profile-${browserName}`);
  await fsp.mkdir(userDataDir, { recursive: true });

  let context = await launchPersistentAppContext(playwright, browserName, userDataDir);
  let page = context.pages()[0] || await context.newPage();
  await page.goto(baseURL);
  await waitForAppReady(page);
  await page.locator("#next-button").click();
  await page.locator("#next-button").click();
  await page.locator("#next-button").click();
  const resumedCardText = await page.locator("#card-front-text").textContent();
  await context.close();

  context = await launchPersistentAppContext(playwright, browserName, userDataDir);
  page = context.pages()[0] || await context.newPage();
  await page.goto(baseURL);
  await waitForAppReady(page);

  await expect(page.locator("#deck-select")).toHaveValue("all");
  await expect(page.locator("#card-front-text")).toHaveText(resumedCardText);

  const preferencesRecord = await readDatabaseRecord(page, "preferences");
  expect(preferencesRecord.kind).toBe("preferences");
  expect(preferencesRecord.value.ui.currentEntryId).toBeTruthy();

  await context.close();
});

test("refreshes a stale cached app shell instead of pinning the old app.js", async ({ browser }) => {
  const scenario = await openScenarioPage(browser);
  await ensureServiceWorkerControlsPage(scenario.page);

  const staleAppJs =
    'document.documentElement.dataset.cachedAppVariant = "stale-shell";\n' +
    fs.readFileSync(APP_JS_PATH, "utf8");

  await scenario.page.evaluate(
    async ({ cacheName, scriptText }) => {
      const cache = await caches.open(cacheName);
      const appJsUrl = new URL("./app.js", location.href).href;
      await cache.put(
        appJsUrl,
        new Response(scriptText, {
          headers: { "Content-Type": "application/javascript" },
        })
      );
    },
    {
      cacheName: SERVICE_WORKER_CACHE_NAME,
      scriptText: staleAppJs,
    }
  );

  await scenario.page.close();
  const reopenedPage = await scenario.context.newPage();
  await reopenedPage.goto("/");
  await waitForAppReady(reopenedPage);

  await expect.poll(async () => {
    return reopenedPage.evaluate(() => ({
      cachedAppVariant: document.documentElement.dataset.cachedAppVariant || null,
      hasController: Boolean(navigator.serviceWorker?.controller),
    }));
  }).toEqual({
    cachedAppVariant: null,
    hasController: true,
  });

  await scenario.context.close();
});

test("prefers the newest localStorage snapshot and backfills IndexedDB", async ({ browser }) => {
  const scenario = await openScenarioPage(browser);
  const newerProgress = makeEnvelope("progress", buildConversationProgress(), NEWER_TIMESTAMP);
  const olderProgress = makeEnvelope("progress", {}, OLDER_TIMESTAMP);
  const newerPreferences = makeEnvelope(
    "preferences",
    buildPreferences({ ui: { deck: "conversationVerbs", currentEntryId: CONVERSATION_ENTRY_ID } }),
    NEWER_TIMESTAMP
  );
  const olderPreferences = makeEnvelope(
    "preferences",
    buildPreferences({ ui: { deck: "mainWords", currentEntryId: "main-0001" } }),
    OLDER_TIMESTAMP
  );

  await writeLocalStorageJson(scenario.page, PROGRESS_STORAGE_KEY, newerProgress);
  await writeLocalStorageJson(scenario.page, PREFERENCES_STORAGE_KEY, newerPreferences);
  await writeDatabaseValue(scenario.page, "progress", olderProgress);
  await writeDatabaseValue(scenario.page, "preferences", olderPreferences);
  await scenario.page.reload();
  await waitForAppReady(scenario.page);

  await expect(scenario.page.locator("#deck-select")).toHaveValue("conversationVerbs");
  await expect(scenario.page.locator("#favorite-button")).toHaveText("Favorited");

  const repairedProgress = await readDatabaseRecord(scenario.page, "progress");
  const repairedPreferences = await readDatabaseRecord(scenario.page, "preferences");
  expect(repairedProgress.updatedAt).toBe(NEWER_TIMESTAMP);
  expect(repairedPreferences.updatedAt).toBe(NEWER_TIMESTAMP);
  expect(repairedProgress.value[CONVERSATION_ENTRY_ID].favorite).toBe(true);
  expect(repairedPreferences.value.ui.deck).toBe("conversationVerbs");
  expect(repairedPreferences.value.ui.currentEntryId).toBe(CONVERSATION_ENTRY_ID);

  await scenario.context.close();
});

test("prefers the newest IndexedDB snapshot and backfills localStorage", async ({ browser }) => {
  const scenario = await openScenarioPage(browser);
  const olderProgress = makeEnvelope("progress", {}, OLDER_TIMESTAMP);
  const newerProgress = makeEnvelope("progress", buildConversationProgress(), NEWER_TIMESTAMP);
  const olderPreferences = makeEnvelope(
    "preferences",
    buildPreferences({ ui: { deck: "mainWords", currentEntryId: "main-0001" } }),
    OLDER_TIMESTAMP
  );
  const newerPreferences = makeEnvelope(
    "preferences",
    buildPreferences({ ui: { deck: "conversationVerbs", currentEntryId: CONVERSATION_ENTRY_ID } }),
    NEWER_TIMESTAMP
  );

  await writeLocalStorageJson(scenario.page, PROGRESS_STORAGE_KEY, olderProgress);
  await writeLocalStorageJson(scenario.page, PREFERENCES_STORAGE_KEY, olderPreferences);
  await writeDatabaseValue(scenario.page, "progress", newerProgress);
  await writeDatabaseValue(scenario.page, "preferences", newerPreferences);
  await scenario.page.reload();
  await waitForAppReady(scenario.page);

  await expect(scenario.page.locator("#deck-select")).toHaveValue("conversationVerbs");
  await expect(scenario.page.locator("#favorite-button")).toHaveText("Favorited");

  const repairedLocalProgress = await readLocalStorageJson(scenario.page, PROGRESS_STORAGE_KEY);
  const repairedLocalPreferences = await readLocalStorageJson(scenario.page, PREFERENCES_STORAGE_KEY);
  expect(repairedLocalProgress.updatedAt).toBe(NEWER_TIMESTAMP);
  expect(repairedLocalPreferences.updatedAt).toBe(NEWER_TIMESTAMP);
  expect(repairedLocalProgress.value[CONVERSATION_ENTRY_ID].favorite).toBe(true);
  expect(repairedLocalPreferences.value.ui.deck).toBe("conversationVerbs");

  await scenario.context.close();
});

test("repairs missing or corrupt stores from the remaining valid snapshot", async ({ browser }) => {
  await test.step("backfills a missing localStorage snapshot from IndexedDB", async () => {
    const scenario = await openScenarioPage(browser);
    const progressEnvelope = makeEnvelope("progress", buildConversationProgress(), NEWER_TIMESTAMP);
    const preferencesEnvelope = makeEnvelope(
      "preferences",
      buildPreferences({ ui: { deck: "conversationVerbs", currentEntryId: CONVERSATION_ENTRY_ID } }),
      NEWER_TIMESTAMP
    );

    await removeLocalStorageKey(scenario.page, PROGRESS_STORAGE_KEY);
    await removeLocalStorageKey(scenario.page, PREFERENCES_STORAGE_KEY);
    await writeDatabaseValue(scenario.page, "progress", progressEnvelope);
    await writeDatabaseValue(scenario.page, "preferences", preferencesEnvelope);
    await scenario.page.reload();
    await waitForAppReady(scenario.page);

    const repairedLocalProgress = await readLocalStorageJson(scenario.page, PROGRESS_STORAGE_KEY);
    const repairedLocalPreferences = await readLocalStorageJson(scenario.page, PREFERENCES_STORAGE_KEY);
    expect(repairedLocalProgress.updatedAt).toBe(NEWER_TIMESTAMP);
    expect(repairedLocalPreferences.updatedAt).toBe(NEWER_TIMESTAMP);
    expect(repairedLocalProgress.value[CONVERSATION_ENTRY_ID].favorite).toBe(true);
    expect(repairedLocalPreferences.value.ui.deck).toBe("conversationVerbs");

    await scenario.context.close();
  });

  await test.step("backfills a missing IndexedDB snapshot from localStorage", async () => {
    const scenario = await openScenarioPage(browser);
    const progressEnvelope = makeEnvelope("progress", buildConversationProgress(), NEWER_TIMESTAMP);
    const preferencesEnvelope = makeEnvelope(
      "preferences",
      buildPreferences({ ui: { deck: "conversationVerbs", currentEntryId: CONVERSATION_ENTRY_ID } }),
      NEWER_TIMESTAMP
    );

    await writeLocalStorageJson(scenario.page, PROGRESS_STORAGE_KEY, progressEnvelope);
    await writeLocalStorageJson(scenario.page, PREFERENCES_STORAGE_KEY, preferencesEnvelope);
    await deleteDatabaseValue(scenario.page, "progress");
    await deleteDatabaseValue(scenario.page, "preferences");
    await scenario.page.reload();
    await waitForAppReady(scenario.page);

    const repairedProgress = await readDatabaseRecord(scenario.page, "progress");
    const repairedPreferences = await readDatabaseRecord(scenario.page, "preferences");
    expect(repairedProgress.updatedAt).toBe(NEWER_TIMESTAMP);
    expect(repairedPreferences.updatedAt).toBe(NEWER_TIMESTAMP);
    expect(repairedProgress.value[CONVERSATION_ENTRY_ID].favorite).toBe(true);
    expect(repairedPreferences.value.ui.deck).toBe("conversationVerbs");

    await scenario.context.close();
  });

  await test.step("repairs corrupt localStorage from IndexedDB", async () => {
    const scenario = await openScenarioPage(browser);
    const progressEnvelope = makeEnvelope("progress", buildConversationProgress(), NEWER_TIMESTAMP);
    const preferencesEnvelope = makeEnvelope(
      "preferences",
      buildPreferences({ ui: { deck: "conversationVerbs", currentEntryId: CONVERSATION_ENTRY_ID } }),
      NEWER_TIMESTAMP
    );

    await writeLocalStorageRaw(scenario.page, PROGRESS_STORAGE_KEY, "{broken-json");
    await writeLocalStorageRaw(scenario.page, PREFERENCES_STORAGE_KEY, "{broken-json");
    await writeDatabaseValue(scenario.page, "progress", progressEnvelope);
    await writeDatabaseValue(scenario.page, "preferences", preferencesEnvelope);
    await scenario.page.reload();
    await waitForAppReady(scenario.page);

    const repairedLocalProgress = await readLocalStorageJson(scenario.page, PROGRESS_STORAGE_KEY);
    const repairedLocalPreferences = await readLocalStorageJson(scenario.page, PREFERENCES_STORAGE_KEY);
    expect(repairedLocalProgress.updatedAt).toBe(NEWER_TIMESTAMP);
    expect(repairedLocalPreferences.updatedAt).toBe(NEWER_TIMESTAMP);

    await scenario.context.close();
  });

  await test.step("repairs corrupt IndexedDB from localStorage", async () => {
    const scenario = await openScenarioPage(browser);
    const progressEnvelope = makeEnvelope("progress", buildConversationProgress(), NEWER_TIMESTAMP);
    const preferencesEnvelope = makeEnvelope(
      "preferences",
      buildPreferences({ ui: { deck: "conversationVerbs", currentEntryId: CONVERSATION_ENTRY_ID } }),
      NEWER_TIMESTAMP
    );

    await writeLocalStorageJson(scenario.page, PROGRESS_STORAGE_KEY, progressEnvelope);
    await writeLocalStorageJson(scenario.page, PREFERENCES_STORAGE_KEY, preferencesEnvelope);
    await writeDatabaseValue(scenario.page, "progress", { schemaVersion: 1, kind: "progress", updatedAt: "broken", value: {} });
    await writeDatabaseValue(scenario.page, "preferences", { schemaVersion: 1, kind: "preferences", updatedAt: "broken", value: {} });
    await scenario.page.reload();
    await waitForAppReady(scenario.page);

    const repairedProgress = await readDatabaseRecord(scenario.page, "progress");
    const repairedPreferences = await readDatabaseRecord(scenario.page, "preferences");
    expect(repairedProgress.updatedAt).toBe(NEWER_TIMESTAMP);
    expect(repairedPreferences.updatedAt).toBe(NEWER_TIMESTAMP);
    expect(repairedProgress.value[CONVERSATION_ENTRY_ID].favorite).toBe(true);
    expect(repairedPreferences.value.ui.deck).toBe("conversationVerbs");

    await scenario.context.close();
  });
});

async function waitForAppReady(page) {
  await expect(page.locator("#hero-description")).not.toContainText("Loading workbook data...");
  await expect(page.locator("#card-front-text")).not.toContainText("Loading...");
  await expect(page.locator("#results-summary")).not.toContainText("Loading list...");
}

async function installSpeechStub(page) {
  await page.evaluate(() => {
    window.__speechCalls = [];
    speakEntry = (entry) => {
      if (!entry) {
        return;
      }

      window.__speechCalls.push({
        text: entry.spanish,
        voiceURI: document.querySelector("#voice-select")?.value || "auto",
        rate: Number(document.querySelector("#speech-rate-input")?.value || "0"),
      });
    };
  });
}

async function ensureServiceWorkerControlsPage(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hasController = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
    if (hasController) {
      return;
    }

    await page.reload();
    await waitForAppReady(page);
  }

  await expect.poll(async () => {
    return page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
  }).toBe(true);
}

async function launchPersistentAppContext(playwright, browserName, userDataDir) {
  return playwright[browserName].launchPersistentContext(userDataDir, {
    acceptDownloads: true,
    viewport: { width: 430, height: 932 },
  });
}

async function openScenarioPage(browser) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.goto("/");
  await waitForAppReady(page);
  await installSpeechStub(page);
  return { context, page };
}

function makeEnvelope(kind, value, updatedAt) {
  return {
    schemaVersion: PERSISTENCE_SCHEMA_VERSION,
    kind,
    updatedAt,
    value,
  };
}

function buildConversationProgress(overrides = {}) {
  return {
    [CONVERSATION_ENTRY_ID]: {
      status: "learning",
      favorite: true,
      reviewCount: 1,
      quizSeen: 1,
      quizCorrect: 0,
      correctStreak: 0,
      wrongCount: 1,
      intervalDays: 0,
      ease: 2.1,
      dueAt: BASE_PROGRESS_TIMESTAMP,
      lastReviewedAt: BASE_PROGRESS_TIMESTAMP,
      lastOutcome: "incorrect",
      ...overrides,
    },
  };
}

function buildPreferences(overrides = {}) {
  return {
    ui: {
      deck: "all",
      session: "all",
      statusFilter: "all",
      band: "all",
      type: "all",
      search: "",
      currentEntryId: null,
      ...overrides.ui,
    },
    quiz: {
      scope: "due",
      direction: "es-en",
      ...overrides.quiz,
    },
    audio: {
      version: 2,
      voiceURI: "auto",
      rate: 0.68,
      ...overrides.audio,
    },
  };
}

async function readDatabaseRecord(page, key) {
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await page.evaluate(
        async ({ databaseName, storeName, recordKey }) => {
          const database = await new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });

          const transaction = database.transaction(storeName, "readonly");
          const store = transaction.objectStore(storeName);
          const record = await new Promise((resolve, reject) => {
            const request = store.get(recordKey);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });

          return record?.value ?? null;
        },
        {
          databaseName: DB_NAME,
          storeName: DB_STORE,
          recordKey: key,
        }
      );
    } catch (error) {
      lastError = error;
      const message = String(error);
      const isTransientIndexedDbError =
        message.includes("Error looking up record in object store by key range") ||
        message.includes("The database connection is closing") ||
        message.includes("One of the specified object stores was not found");

      if (!isTransientIndexedDbError || attempt === 4) {
        throw error;
      }

      await page.waitForTimeout(100);
    }
  }

  throw lastError;
}

async function readLocalStorageJson(page, storageKey) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, storageKey);
}

async function writeLocalStorageJson(page, storageKey, value) {
  await page.evaluate(
    ({ key, nextValue }) => {
      localStorage.setItem(key, JSON.stringify(nextValue));
    },
    { key: storageKey, nextValue: value }
  );
}

async function writeLocalStorageRaw(page, storageKey, raw) {
  await page.evaluate(
    ({ key, value }) => {
      localStorage.setItem(key, value);
    },
    { key: storageKey, value: raw }
  );
}

async function removeLocalStorageKey(page, storageKey) {
  await page.evaluate((key) => {
    localStorage.removeItem(key);
  }, storageKey);
}

async function writeDatabaseValue(page, key, value) {
  await page.evaluate(
    async ({ databaseName, storeName, recordKey, recordValue }) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).put({ key: recordKey, value: recordValue });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    },
    {
      databaseName: DB_NAME,
      storeName: DB_STORE,
      recordKey: key,
      recordValue: value,
    }
  );
}

async function deleteDatabaseValue(page, key) {
  await page.evaluate(
    async ({ databaseName, storeName, recordKey }) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).delete(recordKey);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    },
    {
      databaseName: DB_NAME,
      storeName: DB_STORE,
      recordKey: key,
    }
  );
}

function extractServiceWorkerCacheName() {
  const swSource = fs.readFileSync(SW_PATH, "utf8");
  const match = swSource.match(/const CACHE_NAME = "([^"]+)"/);
  if (!match) {
    throw new Error("Unable to determine the service worker cache name.");
  }
  return match[1];
}
