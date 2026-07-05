const { test, expect } = require("@playwright/test");

// Frontend auth/landing flow. The backend is mocked via page.route so these
// tests need no server and never touch production.

async function mockApi(page, overrides = {}) {
  await page.route((url) => url.pathname.includes("/api/"), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const key = `${req.method()} ${url.pathname}`;
    const json = (status, body) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (overrides[key]) return overrides[key](route, json);

    switch (key) {
      case "POST /api/auth/signup":
        return json(201, { token: "tok-signup", user: { id: "u1", email: "new@example.com", role: "user" } });
      case "POST /api/auth/login":
        return json(200, { token: "tok-login", user: { id: "u1", email: "jane@example.com", role: "user" } });
      case "POST /api/auth/logout":
        return json(200, { ok: true });
      case "GET /api/progress":
        return json(200, { cardState: {} });
      case "PUT /api/progress":
        return json(200, { ok: true, saved: 0 });
      default:
        return json(404, { error: "not mocked" });
    }
  });
}

// Point the client at the page's own origin (so the mocked /api/** calls are
// same-origin — no CORS preflight, which WebKit enforces on intercepted routes)
// and clear any prior session.
async function freshAuthPage(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("spanishApiBase", location.origin);
      localStorage.removeItem("spanishAuth.v1");
      // Prevent the service worker from registering so it can't intercept the
      // mocked /api/ calls (WebKit routes SW fetches around page.route).
      if (navigator.serviceWorker) {
        navigator.serviceWorker.register = () => Promise.resolve({ update() {}, addEventListener() {} });
      }
    } catch (e) {}
  });
}

async function waitForLoaded(page) {
  await page.waitForFunction(() => typeof appState !== "undefined" && appState.loaded && appState.data);
}

// The auth form re-renders on every keystroke, so fill each field by re-querying
// the current node and dispatching a bubbling input event (what a real keypress
// does), then confirm it landed in state before moving on.
async function typeField(page, fid, value) {
  await page.evaluate(
    ({ fid, value }) => {
      const el = document.querySelector(`[data-fid="${fid}"]`);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { fid, value }
  );
}

async function fillCredentials(page, email, password) {
  await typeField(page, "auth-email", email);
  await typeField(page, "auth-password", password);
  await expect
    .poll(() => page.evaluate(() => appState.authEmail && appState.authPassword ? "ok" : ""))
    .toBe("ok");
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await freshAuthPage(page);
  await page.goto("/");
  await waitForLoaded(page);
});

test("shows the landing page with all entry options when signed out", async ({ page }) => {
  const content = page.locator("#content");
  await expect(content).toContainText("Hablavos");
  await expect(content).toContainText("Learn the Spanish people");
  await expect(content.getByRole("button", { name: "Log in" })).toBeVisible();
  await expect(content.getByRole("button", { name: "Sign up" })).toBeVisible();
  await expect(content.getByRole("button", { name: "Continue as guest" })).toBeVisible();
  // The app itself is gated — no tab bar yet.
  await expect(page.locator("#tab-bar")).toBeEmpty();
});

test("Continue as guest opens the app without an account", async ({ page }) => {
  await page.locator("#content").getByRole("button", { name: "Continue as guest" }).click();
  await expect.poll(() => page.evaluate(() => appState.guest)).toBe(true);
  await expect(page.locator("#content")).toContainText("¡Hola! 🇬🇹");
  await expect(page.locator("#tab-bar")).not.toBeEmpty();
});

test("signup logs the user in and enters the app", async ({ page }) => {
  const content = page.locator("#content");
  await content.getByRole("button", { name: "Sign up" }).click();
  await fillCredentials(page, "new@example.com", "password123");
  await content.getByRole("button", { name: "Create account" }).click();

  await expect.poll(() => page.evaluate(() => appState.auth.user?.email)).toBe("new@example.com");
  await expect(content).toContainText("¡Hola! 🇬🇹");
  // Session is persisted for next launch.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("spanishAuth.v1")).token)).toBe("tok-signup");
});

test("a failed login shows an error and stays on the auth screen", async ({ page }) => {
  await mockApi(page, {
    "POST /api/auth/login": (route, json) => json(401, { error: "Invalid email or password." }),
  });

  const content = page.locator("#content");
  await content.getByRole("button", { name: "Log in" }).click();
  await fillCredentials(page, "jane@example.com", "wrongpass");
  await content.getByRole("button", { name: "Log in" }).click();

  await expect(content).toContainText("Invalid email or password.");
  expect(await page.evaluate(() => appState.auth.user)).toBeNull();
});

test("logout returns to the landing page", async ({ page }) => {
  const content = page.locator("#content");
  // Log in first.
  await content.getByRole("button", { name: "Log in" }).click();
  await fillCredentials(page, "jane@example.com", "password123");
  await content.getByRole("button", { name: "Log in" }).click();
  await expect.poll(() => page.evaluate(() => !!appState.auth.user)).toBe(true);

  // Open settings and log out.
  await page.evaluate(() => setState({ route: "settings" }));
  await content.getByRole("button", { name: "Log out" }).click();

  await expect(content.getByRole("button", { name: "Continue as guest" })).toBeVisible();
  expect(await page.evaluate(() => appState.auth.user)).toBeNull();
});

test("Reset progress clears the server for a logged-in user", async ({ page }) => {
  const puts = [];
  // Record every progress upsert so we can assert the reset reaches the server.
  await mockApi(page, {
    "PUT /api/progress": (route, json) => {
      const body = JSON.parse(route.request().postData() || "{}");
      puts.push(body.cardState || {});
      return json(200, { ok: true, saved: Object.keys(body.cardState || {}).length });
    },
  });

  const content = page.locator("#content");
  await content.getByRole("button", { name: "Log in" }).click();
  await fillCredentials(page, "jane@example.com", "password123");
  await content.getByRole("button", { name: "Log in" }).click();
  await expect.poll(() => page.evaluate(() => !!appState.auth.user)).toBe(true);

  // Study a card.
  await page.evaluate(() => setProg("main-0001", "known"));
  await expect.poll(() => page.evaluate(() => appState.cardState["main-0001"].state)).toBe("known");

  // Reset progress (two taps: arm, then confirm).
  await page.evaluate(() => setState({ route: "settings" }));
  await content.getByRole("button", { name: /Reset progress/ }).click();
  await content.getByRole("button", { name: /confirm reset/i }).click();

  // The card is neutralized locally AND a neutralizing upsert was sent to the server.
  expect(await page.evaluate(() => appState.cardState["main-0001"].state)).toBe("new");
  await expect
    .poll(() => puts.some((cs) => cs["main-0001"] && cs["main-0001"].state === "new" && !cs["main-0001"].seen))
    .toBe(true);
});
