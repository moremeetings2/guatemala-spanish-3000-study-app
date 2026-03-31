const { test, expect } = require("@playwright/test");

const DB_NAME = "guatemala-spanish-study-app-db";
const DB_STORE = "appState";

test.beforeEach(async ({ context, page }) => {
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

  const progress = await readDatabaseRecord(page, "progress");
  expect(progress["conversation-001-soy-nuevo-aqu"].favorite).toBe(true);
  expect(progress["conversation-001-soy-nuevo-aqu"].status).toBe("learning");
});

test("runs quiz interactions and pronunciation controls", async ({ page }) => {
  await page.locator("#quiz-scope").selectOption("all");
  await expect(page.locator("#quiz-prompt")).not.toHaveText(/Loading quiz/);

  const firstOption = page.locator("#quiz-options .quiz-option").first();
  const optionCount = await page.locator("#quiz-options .quiz-option").count();
  expect(optionCount).toBe(4);
  await firstOption.click();

  await expect(page.locator("#quiz-feedback")).not.toHaveText("");
  await expect(page.locator("#quiz-meta")).toContainText("Score");

  await page.locator("#speak-button").click();
  await page.locator("#quiz-speak-button").click();

  const speechCalls = await page.evaluate(() => window.__speechCalls);
  expect(speechCalls.length).toBeGreaterThanOrEqual(2);
  expect(speechCalls[0].lang).toBe("es-GT");
});

test("persists preferences and progress across reload and supports export/import", async ({ browser, page }) => {
  await page.locator("#deck-select").selectOption("conversationVerbs");
  await page.locator("#quiz-direction").selectOption("en-es");
  await page.locator("#favorite-button").click();

  await page.reload();
  await waitForAppReady(page);

  await expect(page.locator("#deck-select")).toHaveValue("conversationVerbs");
  await expect(page.locator("#quiz-direction")).toHaveValue("en-es");
  await expect(page.locator("#favorite-button")).toHaveText("Favorited");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-progress-button").click();
  const download = await downloadPromise;
  const exportJson = JSON.parse(await download.path().then((path) => require("fs").readFileSync(path, "utf8")));
  expect(exportJson.preferences.ui.deck).toBe("conversationVerbs");
  expect(exportJson.preferences.quiz.direction).toBe("en-es");
  expect(exportJson.progress["conversation-001-soy-nuevo-aqu"].favorite).toBe(true);

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
        search: "",
      },
      quiz: {
        scope: "all",
        direction: "es-en",
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
  await expect(cleanPage.locator("#card-front-text")).toHaveText("de");
  await expect(cleanPage.locator("#favorite-button")).toHaveText("Favorited");

  const importedPreferences = await readDatabaseRecord(cleanPage, "preferences");
  expect(importedPreferences.ui.deck).toBe("mainWords");
  expect(importedPreferences.quiz.scope).toBe("all");

  await cleanContext.close();
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
        lang: "es-GT",
        rate: 0.9,
      });
    };
  });
}

async function readDatabaseRecord(page, key) {
  return page.evaluate(
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
}
