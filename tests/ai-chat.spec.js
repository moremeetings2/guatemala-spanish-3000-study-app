const { test, expect } = require("@playwright/test");

// AI tutor chat flow. The real on-device model (wllama + a multi-hundred-MB
// GGUF from a CDN) is never loaded in tests — we boot with __NO_AI__ set so the
// background download never starts, then swap in a fake `window.AI` that streams
// a canned reply. This exercises the chat overlay, context wiring, and streaming
// render path without any network model.

async function boot(page) {
  // Signed-in user + mocked backend (accounts are required to reach the app).
  await page.route((url) => url.pathname.includes("/api/"), (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cardState: {}, ok: true }) })
  );
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
  // Replace the real engine with a fake that reports "ready" and streams a reply.
  await page.evaluate(() => {
    window.AI = {
      MODELS: {
        "350M": { label: "350M", note: "Fastest", mb: 229 },
        "700M": { label: "700M", note: "Balanced", mb: 469 },
        "1.2B": { label: "1.2B", note: "Best", mb: 731 },
      },
      getState: () => ({ status: "ready", progress: 1, size: "1.2B", error: "", model: { label: "1.2B", mb: 731 } }),
      isSupported: () => true,
      onChange: () => () => {},
      ensureLoaded: () => Promise.resolve(),
      setModelSize: () => Promise.resolve(),
      currentSize: () => "1.2B",
      lastMessages: null,
      chat: async (messages, opts) => {
        window.AI.lastMessages = messages;
        const reply = 'Claro. "de" means "of" or "from".';
        let acc = "";
        for (const ch of reply.split("")) { acc += ch; if (opts && opts.onToken) opts.onToken(acc, ch); }
        return reply;
      },
    };
    setState({ ai: { status: "ready", progress: 1, size: "1.2B", error: "" } });
  });
}

async function typeChat(page, value) {
  await page.evaluate((v) => {
    const el = document.querySelector('[data-fid="chat-input"]');
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await expect.poll(() => page.evaluate(() => appState.chat.input)).toBe(value);
}

test("general AI chat: open from home, send a message, receive a streamed reply", async ({ page }) => {
  await boot(page);

  // Open the general tutor from the home card.
  await page.locator("#content").getByText("Ask anything in Spanish").click();
  await expect.poll(() => page.evaluate(() => appState.chat.open)).toBe(true);

  const sheet = page.locator("#chat-sheet");
  await expect(sheet).toContainText("Your Spanish tutor");

  await typeChat(page, "What does de mean?");
  await page.locator('[data-fid="chat-input"]').press("Enter");

  // The streamed assistant reply lands in the transcript.
  await expect(sheet).toContainText('"de" means "of" or "from"');
  // The user's message is recorded too.
  expect(await page.evaluate(() => appState.chat.messages.filter((m) => m.role === "user").length)).toBe(1);
  // No context => general system prompt.
  expect(await page.evaluate(() => appState.chat.context)).toBeNull();
});

test("vocab-card chat opens with the word already in context", async ({ page }) => {
  await boot(page);

  // Drive the study deck to a known main word and open its chat button.
  await page.evaluate(() => {
    const card = appState.data.CARDS.find((c) => c.deck === "mainWords" && c.es === "de");
    const pos = appState.study.order.indexOf(card.id);
    setState({ tab: "study", route: null, study: { ...appState.study, idx: pos < 0 ? 0 : pos, flipped: false, showSentence: false } });
  });
  await page.locator("#content").getByTitle("Ask the AI tutor").click();

  await expect.poll(() => page.evaluate(() => appState.chat.open)).toBe(true);
  // The context carries the word and a word-specific system prompt.
  expect(await page.evaluate(() => appState.chat.context?.title)).toBe("de");
  expect(await page.evaluate(() => appState.chat.context?.system || "")).toContain('"de"');
  await expect(page.locator("#chat-sheet")).toContainText("de");

  // Sending forwards the system prompt to the engine.
  await typeChat(page, "Explain this word");
  await page.locator('[data-fid="chat-input"]').press("Enter");
  await expect(page.locator("#chat-sheet")).toContainText('"de" means');
  expect(await page.evaluate(() => window.AI.lastMessages[0].role)).toBe("system");
  expect(await page.evaluate(() => window.AI.lastMessages[0].content)).toContain('"de"');
});
