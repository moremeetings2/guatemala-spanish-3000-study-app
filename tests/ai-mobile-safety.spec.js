const { devices, expect, test } = require("@playwright/test");

async function routeFakeAI(page) {
  await page.route("**/ai.js", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        window.__aiLoadCalls = 0;
        window.AI = {
          MODELS: {
            "350M": { label: "350M", note: "Fastest", mb: 229 },
            "700M": { label: "700M", note: "Balanced", mb: 469 },
            "1.2B": { label: "1.2B", note: "Best", mb: 731 },
          },
          getState: () => ({ status: "idle", progress: 0, size: "350M", error: "", model: { label: "350M", mb: 229 } }),
          isSupported: () => true,
          onChange: () => () => {},
          ensureLoaded: () => {
            window.__aiLoadCalls += 1;
            return Promise.resolve();
          },
          setModelSize: () => Promise.resolve(),
          currentSize: () => "350M",
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
