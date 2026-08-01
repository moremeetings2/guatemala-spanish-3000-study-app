const { test, expect } = require("@playwright/test");

async function boot(page, requests) {
  await page.route((url) => url.pathname.includes("/api/"), (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cardState: {}, ok: true, saved: 0 }),
    })
  );
  page.on("request", (request) => {
    const url = request.url();
    if (
      url.includes("webml-community-gemma-4-webgpu-kernels")
      || url.includes("huggingface.co/google/gemma-4")
      || url.includes("hf.co/google/gemma-4")
    ) requests.push(url);
  });
  await page.addInitScript(() => {
    window.__NO_AI__ = true;
    localStorage.setItem("spanishApiBase", location.origin);
    localStorage.setItem(
      "spanishAuth.v1",
      JSON.stringify({
        token: "test-token",
        user: { id: "u", email: "tester@example.com", role: "user" },
      })
    );
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () =>
        Promise.resolve({ update() {}, addEventListener() {} });
    }
  });
  await page.goto("/");
  await page.waitForFunction(() => typeof appState !== "undefined" && appState.loaded);
}

test("publishes one fixed Gemma 4 model and does not fetch it at boot", async ({ page }) => {
  const requests = [];
  await boot(page, requests);

  const contract = await page.evaluate(() => ({
    models: Object.keys(window.AI.MODELS),
    model: window.AI.getState().model,
    canSelect: typeof window.AI.setModelSize,
  }));

  expect(contract.models).toEqual(["gemma-4-e2b"]);
  expect(contract.model.label).toBe("Gemma 4 E2B");
  expect(contract.model.mb).toBe(2400);
  expect(contract.canSelect).toBe("undefined");
  expect(requests).toEqual([]);
});

test("Settings presents Gemma 4 as fixed model information", async ({ page }) => {
  const requests = [];
  await boot(page, requests);
  await page.evaluate(() => {
    window.AI = {
      MODELS: {
        "gemma-4-e2b": {
          label: "Gemma 4 E2B",
          note: "WebGPU on-device model",
          mb: 2400,
        },
      },
      getState: () => ({
        status: "idle", progress: 0, size: "gemma-4-e2b", error: "",
      }),
      isSupported: () => true,
      onChange: () => () => {},
      ensureLoaded: () => Promise.resolve(),
      currentSize: () => "gemma-4-e2b",
    };
    setState({
      route: "settings",
      ai: { status: "idle", progress: 0, size: "gemma-4-e2b", error: "" },
    });
  });

  const settings = page.locator("#content");
  await expect(settings.getByText("Gemma 4 E2B")).toBeVisible();
  await expect(settings.getByText("~2.4 GB first download")).toBeVisible();
  await expect(settings.getByText("Bigger models answer better")).toHaveCount(0);
  await expect(settings.getByRole("button", { name: /Gemma 4 E2B/ })).toHaveCount(0);
});

test("signed-in desktop boot waits for explicit AI use", async ({ page }) => {
  const modelRequests = [];
  await page.route((url) => url.pathname.includes("/api/"), (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cardState: {}, ok: true, saved: 0 }),
    })
  );
  await page.route("https://webml-community-gemma-4-webgpu-kernels.static.hf.space/**", (route) => {
    modelRequests.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", { configurable: true, value: {} });
    localStorage.setItem("spanishApiBase", location.origin);
    localStorage.setItem(
      "spanishAuth.v1",
      JSON.stringify({ token: "test-token", user: { id: "u", email: "tester@example.com", role: "user" } })
    );
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => Promise.resolve({ update() {}, addEventListener() {} });
    }
  });

  await page.goto("/");
  await page.waitForFunction(() => typeof appState !== "undefined" && appState.loaded);
  await page.waitForTimeout(500);
  expect(modelRequests).toEqual([]);
});
