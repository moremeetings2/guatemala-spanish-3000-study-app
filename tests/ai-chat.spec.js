const { test, expect } = require("@playwright/test");

// AI tutor chat flow. The real multi-gigabyte Gemma 4 WebGPU model is never
// loaded in tests — we boot with __NO_AI__ set so the
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
  await page.route("**/ai.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: `
      window.AI = {
        MODELS: { "gemma-4-e2b": { label: "Gemma 4 E2B", note: "WebGPU on-device model", mb: 2400 } },
        getState: () => ({ status: "ready", progress: 1, size: "gemma-4-e2b", error: "", model: { label: "Gemma 4 E2B", mb: 2400 } }),
        isSupported: () => true,
        onChange: () => () => {},
        ensureLoaded: () => Promise.resolve(),
        currentSize: () => "gemma-4-e2b",
        lastMessages: null,
        chat: async (messages, opts) => {
          window.AI.lastMessages = messages;
          const reply = 'Claro. "de" means "of" or "from".';
          let acc = "";
          for (const ch of reply.split("")) {
            acc += ch;
            if (opts && opts.onToken) opts.onToken(acc, ch);
          }
          return reply;
        },
      };
    `,
  }));
  await page.goto("/");
  await page.waitForFunction(() => typeof appState !== "undefined" && appState.loaded && appState.data);
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

test("iOS dictation keeps the active chat field mounted across background updates", async ({ page }) => {
  await boot(page);
  await page.locator("#content").getByText("Ask anything in Spanish").click();

  const result = await page.evaluate(() => {
    const input = document.querySelector('[data-fid="chat-input"]');
    input.focus();
    input.value = "¿Cómo se dice trabajo?";
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertFromDictation",
      data: "¿Cómo se dice trabajo?",
    }));
    // Safari can still be composing when voiceschanged, AI progress, or sync
    // publishes an unrelated state update. That must not replace the field.
    setState({ voices: [...appState.voices] });
    return {
      sameNode: document.querySelector('[data-fid="chat-input"]') === input,
      focused: document.activeElement === input,
      stateValue: appState.chat.input,
      sendEnabled: document.querySelector('[data-fid="chat-send"]')
        ? !document.querySelector('[data-fid="chat-send"]').disabled
        : false,
    };
  });

  expect(result).toEqual({
    sameNode: true,
    focused: true,
    stateValue: "¿Cómo se dice trabajo?",
    sendEnabled: true,
  });
});

test("the chat microphone puts Safari speech recognition into the query field", async ({ page }) => {
  await page.addInitScript(() => {
    class FakeSpeechRecognition {
      start() {
        this.onstart?.();
        this.onresult?.({
          resultIndex: 0,
          results: [{ 0: { transcript: "Como se dice trabajo" }, isFinal: true }],
        });
        this.onend?.();
      }
      stop() { this.onend?.(); }
    }
    window.SpeechRecognition = FakeSpeechRecognition;
    window.webkitSpeechRecognition = FakeSpeechRecognition;
  });
  await boot(page);
  await page.locator("#content").getByText("Ask anything in Spanish").click();

  await page.locator('[data-fid="chat-dictate"]').click();

  await expect(page.locator('[data-fid="chat-input"]')).toHaveValue("Como se dice trabajo");
  await expect.poll(() => page.evaluate(() => appState.chat.input)).toBe("Como se dice trabajo");
  await expect(page.locator('[data-fid="chat-send"]')).toBeEnabled();
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
