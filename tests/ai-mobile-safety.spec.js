const { devices, expect, test } = require("@playwright/test");

async function routeFakeAI(page) {
  await page.route("**/ai.js", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        window.__aiLoadCalls = 0;
        window.AI = {
          MODELS: { "gemma-4-e2b": { label: "Gemma 4 E2B", note: "WebGPU on-device model", mb: 2400 } },
          getState: () => ({ status: "idle", progress: 0, size: "gemma-4-e2b", error: "", model: { label: "Gemma 4 E2B", mb: 2400 } }),
          isSupported: () => true,
          onChange: () => () => {},
          ensureLoaded: () => {
            window.__aiLoadCalls += 1;
            return Promise.resolve();
          },
          currentSize: () => "gemma-4-e2b",
          hadLoadCrash: () => false,
          isMobileDevice: () => true,
          chat: async () => "ok",
        };
      `,
    });
  });
}

async function routeMockApi(page) {
  await page.route((url) => url.pathname.includes("/api/"), (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cardState: {}, ok: true, saved: 0 }),
    })
  );
}

test("mobile sessions defer AI model loading until the tutor is opened", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  await routeFakeAI(page);
  await routeMockApi(page);
  await page.addInitScript(() => {
    try {
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

  await page.goto(baseURL || "/");
  await page.waitForFunction(() => typeof appState !== "undefined" && appState.loaded && appState.data);

  await expect.poll(() => page.evaluate(() => window.__aiLoadCalls)).toBe(0);

  await page.locator("#content").getByText("Ask anything in Spanish").click();
  await expect.poll(() => page.evaluate(() => window.__aiLoadCalls)).toBe(1);

  await context.close();
});
