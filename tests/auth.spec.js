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
      window.__NO_AI__ = true; // don't download the on-device model in tests
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
  await page.locator(`[data-fid="${fid}"]`).evaluate(
    (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value
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
  // Accounts are required — there is no guest entry point.
  await expect(content.getByRole("button", { name: "Continue as guest" })).toHaveCount(0);
  // The app itself is gated — no tab bar yet.
  await expect(page.locator("#tab-bar")).toBeEmpty();
});

test("landing country grid expands to all 21 countries and collapses again", async ({ page }) => {
  const content = page.locator("#content");
  // Collapsed: the classic four.
  await expect(content).toContainText("Guatemala");
  await expect(content).toContainText("El Salvador");
  await expect(content).not.toContainText("Equatorial Guinea");

  await content.getByRole("button", { name: /See all 21 countries/ }).click();
  await expect(content).toContainText("Argentina");
  await expect(content).toContainText("Spain");
  await expect(content).toContainText("Equatorial Guinea");

  await content.getByRole("button", { name: /Show fewer countries/ }).click();
  await expect(content).not.toContainText("Equatorial Guinea");
});

test("landing stays mounted when non-visible voice state loads", async ({ page }) => {
  const stayedMounted = await page.evaluate(() => {
    const root = document.querySelector("#content > div");
    root.dataset.stabilityProbe = "landing";
    setState({ voices: [{ voiceURI: "es-test", name: "Spanish Test", lang: "es-GT", localService: true }] });
    return document.querySelector("#content > div")?.dataset.stabilityProbe === "landing";
  });

  expect(stayedMounted).toBe(true);
});

test("typing in auth fields does not replace the focused input", async ({ page }) => {
  const content = page.locator("#content");
  await content.getByRole("button", { name: "Log in" }).click();

  const result = await page.evaluate(() => {
    const email = document.querySelector('[data-fid="auth-email"]');
    email.dataset.stabilityProbe = "email";
    email.value = "j";
    email.dispatchEvent(new Event("input", { bubbles: true }));

    const password = document.querySelector('[data-fid="auth-password"]');
    password.dataset.stabilityProbe = "password";
    password.value = "p";
    password.dispatchEvent(new Event("input", { bubbles: true }));

    return {
      emailStable: document.querySelector('[data-fid="auth-email"]')?.dataset.stabilityProbe === "email",
      passwordStable: document.querySelector('[data-fid="auth-password"]')?.dataset.stabilityProbe === "password",
      stateEmail: appState.authEmail,
      statePassword: appState.authPassword,
    };
  });

  expect(result).toEqual({
    emailStable: true,
    passwordStable: true,
    stateEmail: "j",
    statePassword: "p",
  });
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

  // Back on the landing page (Sign up entry point visible), signed out.
  await expect(content).toContainText("Learn the Spanish people");
  await expect(content.getByRole("button", { name: "Sign up" })).toBeVisible();
  expect(await page.evaluate(() => appState.auth.user)).toBeNull();
});

test("logout clears one account's progress before another account logs in", async ({ page }) => {
  const content = page.locator("#content");
  await content.getByRole("button", { name: "Log in" }).click();
  await fillCredentials(page, "jane@example.com", "password123");
  await content.getByRole("button", { name: "Log in" }).click();
  await expect.poll(() => page.evaluate(() => appState.auth.user?.id)).toBe("u1");

  const lexiconId = await page.evaluate(() => {
    const card = appState.data.CARDS.find((c) => c.deck === "guatemalaLexicon");
    toggleStar(card.id);
    return card.id;
  });
  await expect.poll(() => page.evaluate((id) => appState.cardState[id].star, lexiconId)).toBe(true);

  await page.evaluate(() => setState({ route: "settings" }));
  await content.getByRole("button", { name: "Log out" }).click();
  await expect.poll(() => page.evaluate(() => appState.auth.user)).toBe(null);

  const uploaded = [];
  await mockApi(page, {
    "POST /api/auth/login": (route, json) => json(200, {
      token: "tok-second",
      user: { id: "u2", email: "sam@example.com", role: "user" },
    }),
    "PUT /api/progress": (route, json) => {
      uploaded.push(JSON.parse(route.request().postData() || "{}").cardState || {});
      return json(200, { ok: true, saved: 0 });
    },
  });

  await content.getByRole("button", { name: "Log in" }).click();
  await fillCredentials(page, "sam@example.com", "password123");
  await content.getByRole("button", { name: "Log in" }).click();
  await expect.poll(() => page.evaluate(() => appState.auth.user?.id)).toBe("u2");
  await expect.poll(() => page.evaluate(() => appState.syncing)).toBe(false);

  expect(await page.evaluate((id) => appState.cardState[id].star, lexiconId)).toBe(false);
  expect(await page.evaluate(() => filterCards({ deck: "mostCommonGuate" }).length)).toBe(0);
  expect(uploaded.some((cards) => cards[lexiconId]?.star)).toBe(false);
});

test("a delayed progress response cannot restore data after logout", async ({ page }) => {
  await mockApi(page, {
    "GET /api/progress": async (route, json) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return json(200, {
        cardState: {
          "lexicon-gt_0001": {
            state: "known", due: null, seen: true, correct: 3, wrong: 0, weak: false, star: true,
          },
        },
      });
    },
  });

  const content = page.locator("#content");
  await content.getByRole("button", { name: "Log in" }).click();
  await fillCredentials(page, "jane@example.com", "password123");
  await content.getByRole("button", { name: "Log in" }).click();
  await expect.poll(() => page.evaluate(() => appState.auth.user?.id)).toBe("u1");

  await page.evaluate(() => doLogout());
  await expect.poll(() => page.evaluate(() => appState.auth.user)).toBe(null);
  await page.waitForTimeout(900);

  expect(await page.evaluate(() => appState.cardState["lexicon-gt_0001"].star)).toBe(false);
  expect(await page.evaluate(() => filterCards({ deck: "mostCommonGuate" }).length)).toBe(0);
});

test("a delayed progress upload cannot log out the next account", async ({ page }) => {
  let uploadStarted;
  const started = new Promise((resolve) => { uploadStarted = resolve; });
  await mockApi(page, {
    "PUT /api/progress": async (route, json) => {
      uploadStarted();
      await new Promise((resolve) => setTimeout(resolve, 700));
      return json(401, { error: "Expired account A token" });
    },
  });

  const content = page.locator("#content");
  await content.getByRole("button", { name: "Log in" }).click();
  await fillCredentials(page, "jane@example.com", "password123");
  await content.getByRole("button", { name: "Log in" }).click();
  await expect.poll(() => page.evaluate(() => appState.auth.user?.id)).toBe("u1");

  await page.evaluate(() => {
    setProg("main-0001", "known");
    clearTimeout(progressSyncTimer);
    pushProgress();
  });
  await started;
  await page.evaluate(() => doLogout());
  await expect.poll(() => page.evaluate(() => appState.auth.user)).toBe(null);

  await mockApi(page, {
    "POST /api/auth/login": (route, json) => json(200, {
      token: "tok-second",
      user: { id: "u2", email: "sam@example.com", role: "user" },
    }),
  });
  await content.getByRole("button", { name: "Log in" }).click();
  await fillCredentials(page, "sam@example.com", "password123");
  await content.getByRole("button", { name: "Log in" }).click();
  await expect.poll(() => page.evaluate(() => appState.auth.user?.id)).toBe("u2");
  await page.waitForTimeout(900);

  expect(await page.evaluate(() => appState.auth.user?.id)).toBe("u2");
  expect(await page.evaluate(() => dirtyCards.size)).toBe(0);
});

test("logging back into the same account restores its local study snapshot", async ({ page }) => {
  const content = page.locator("#content");
  await content.getByRole("button", { name: "Log in" }).click();
  await fillCredentials(page, "jane@example.com", "password123");
  await content.getByRole("button", { name: "Log in" }).click();
  await expect.poll(() => page.evaluate(() => appState.auth.user?.id)).toBe("u1");

  const targetId = await page.evaluate(() => {
    const card = appState.data.CARDS.find((c) => c.es === "abandonar");
    const idx = appState.study.order.indexOf(card.id);
    setState({
      saved: [{ es: "mercado", en: "market" }],
      completed: { "story-a": true }, storyId: "story-a", reviewedToday: 4, streak: 2,
      study: { ...appState.study, idx },
    });
    return card.id;
  });
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem("spanishStudyApp.v1");
    return raw ? JSON.parse(raw).study?.cardId : null;
  })).toBe(targetId);

  await page.evaluate(() => setState({ route: "settings" }));
  await content.getByRole("button", { name: "Log out" }).click();
  await expect.poll(() => page.evaluate(() => appState.auth.user)).toBe(null);

  await content.getByRole("button", { name: "Log in" }).click();
  await fillCredentials(page, "jane@example.com", "password123");
  await content.getByRole("button", { name: "Log in" }).click();
  await expect.poll(() => page.evaluate(() => appState.auth.user?.id)).toBe("u1");
  await expect.poll(() => page.evaluate(() => appState.study.order[appState.study.idx])).toBe(targetId);
  await expect.poll(() => page.evaluate(() => appState.saved[0]?.es)).toBe("mercado");
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("spanishStudyApp.v1.account.u1")).study.cardId)).toBe(targetId);

  expect(await page.evaluate(() => appState.saved)).toEqual([{ es: "mercado", en: "market" }]);
  expect(await page.evaluate(() => appState.completed["story-a"])).toBe(true);
  expect(await page.evaluate(() => [appState.reviewedToday, appState.streak])).toEqual([4, 2]);
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
