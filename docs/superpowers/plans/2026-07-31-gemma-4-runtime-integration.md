# Gemma 4 Browser Runtime Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Hablavos's selectable wllama/LiquidAI engine with the single Gemma 4 E2B WebGPU runtime and Safari-safe model harness from `moorej2400/gemma-4-webml-webgpu`.

**Architecture:** Copy the upstream runtime infrastructure unchanged into `ai-runtime/`, then expose it through a Hablavos-owned ES-module adapter that retains the existing `window.AI` state, loading, and streaming chat API. Keep model weights and the generated third-party runtime out of Git; the hash-pinned browser loader downloads, verifies, patches, and evaluates upstream only after acquiring an exclusive Web Lock.

**Tech Stack:** Static ES modules, WebGPU, Web Locks, OPFS, Fetch, Web Crypto, Playwright, Node test runner, GitHub Pages service worker.

---

## File Map

- `ai-runtime/`: direct upstream runtime infrastructure and required vendor, patch, manifest, and attribution files.
- `ai-runtime/hablavos-ai.js`: Hablavos adapter, state translation, generation streaming, and lifecycle installation.
- `ai.js`: classic-script bootstrap that imports the adapter and publishes `window.AI`.
- `app.js`: remove model selection/background loading and map Gemma states into existing UI.
- `sw.js`: cache local runtime infrastructure, never model weights or cross-origin runtime bytes.
- `tests/gemma-runtime.spec.js`: integration contract and UI behavior without downloading the model.
- `tests/upstream-runtime/`: deterministic upstream ownership, lifecycle, loader, platform, patch, range, and OPFS tests.
- `README.md`, `THIRD_PARTY_NOTICES.md`: requirements, provenance, identity, size, and browser behavior.

### Task 1: Vendor The Tested Runtime Infrastructure

**Files:**
- Create: `ai-runtime/browser-runtime-loader.js`
- Create: `ai-runtime/model-lifecycle.js`
- Create: `ai-runtime/model-session.js`
- Create: `ai-runtime/page-lifecycle.js`
- Create: `ai-runtime/platform-profile.js`
- Create: `ai-runtime/runtime-patch.js`
- Create: `ai-runtime/weight-range-plan.js`
- Create: `ai-runtime/disk-backed-embedding.js`
- Create: `ai-runtime/runtime-manifest.json`
- Create: `ai-runtime/patches/gemma-ios-memory.patch`
- Create: `ai-runtime/vendor/*`
- Test: `tests/upstream-runtime/*.test.mjs`

- [ ] **Step 1: Copy the upstream deterministic tests first**

Copy `model-session.test.mjs`, `model-lifecycle.test.mjs`, `page-lifecycle.test.mjs`, `platform-profile.test.mjs`, `runtime-patch.test.mjs`, `browser-runtime-loader.test.mjs`, `weight-range-plan.test.mjs`, `disk-backed-embedding.test.mjs`, and their fixture into `tests/upstream-runtime/`. Rewrite only relative imports and fixture URLs from repository-root modules to `../../ai-runtime/<module>`.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test tests/upstream-runtime/*.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `ai-runtime/`.

- [ ] **Step 3: Copy production modules byte-for-byte**

Copy the listed modules, manifest, patch, vendor assets, and licenses from source commit `b3226e158bb78da66e5932e47ecf0401a5d8920b`. Preserve source filenames and relative layout so manifest URLs and import allowlisting remain valid.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
node --test tests/upstream-runtime/*.test.mjs
```

Expected: all copied runtime tests pass.

- [ ] **Step 5: Commit the vendored infrastructure**

```bash
git add ai-runtime tests/upstream-runtime
git commit -m "feat: vendor Gemma 4 browser runtime infrastructure"
```

### Task 2: Build The Hablavos Compatibility Adapter

**Files:**
- Create: `ai-runtime/hablavos-ai.js`
- Modify: `ai.js`
- Test: `tests/gemma-runtime.spec.js`

- [ ] **Step 1: Write a failing browser contract test**

Load with authenticated local state and `window.__NO_AI__ = true`, intercept all upstream/model hosts, and assert:

```js
const contract = await page.evaluate(() => ({
  models: Object.keys(window.AI.MODELS),
  model: window.AI.getState().model,
  canSelect: typeof window.AI.setModelSize,
}));
expect(contract.models).toEqual(['gemma-4-e2b']);
expect(contract.model.label).toBe('Gemma 4 E2B');
expect(contract.model.mb).toBe(2400);
expect(contract.canSelect).toBe('undefined');
expect(modelRequests).toHaveLength(0);
```

- [ ] **Step 2: Run and verify RED**

```bash
npx playwright test tests/gemma-runtime.spec.js --project=chromium
```

Expected: FAIL because the existing facade exposes three models and `setModelSize`.

- [ ] **Step 3: Implement the adapter API**

Create `ai-runtime/hablavos-ai.js` with injectable dependencies and these fixed values:

```js
export const MODEL_KEY = 'gemma-4-e2b';
export const MODEL = Object.freeze({
  id: 'google/gemma-4-E2B-it-qat-mobile-transformers',
  label: 'Gemma 4 E2B',
  note: 'WebGPU on-device model',
  mb: 2400,
});
```

`createHablavosAI(deps)` constructs `ModelSession` and `ModelLifecycle`, translates lifecycle/progress state, defers `loadBrowserRuntime`, streams `model.generate()`, and exposes `MODELS`, `getState`, `isSupported`, `onChange`, `ensureLoaded`, `chat`, `currentSize`, `hadLoadCrash`, `isMobileDevice`, and `dispose`. It exposes no selection method. `__NO_AI__` prevents model fetch but does not remove the facade.

- [ ] **Step 4: Replace the classic bootstrap**

Make `ai.js` dynamically import `./ai-runtime/hablavos-ai.js`, publish a stable facade immediately, preserve early subscribers, and turn import failures into `status: 'error'` with rejected `ensureLoaded()`.

- [ ] **Step 5: Verify GREEN**

Run the focused Chromium test and require the contract and zero-boot-request assertions to pass.

### Task 3: Map Lifecycle, Streaming, And Cleanup

**Files:**
- Modify: `ai-runtime/hablavos-ai.js`
- Modify: `tests/gemma-runtime.spec.js`
- Modify: `tests/ai-chat.spec.js`
- Modify: `tests/my-words.spec.js`

- [ ] **Step 1: Add failing adapter behavior tests**

With injected fake locks/runtime/model, assert streamed full and delta text:

```js
const answer = await ai.chat([{ role: 'user', content: 'Hola' }], {
  maxTokens: 16,
  onToken: (full, piece) => emissions.push({ full, piece }),
});
expect(answer).toBe('Hola, ¿cómo estás?');
expect(emissions).toEqual([
  { full: 'Hola, ', piece: 'Hola, ' },
  { full: 'Hola, ¿cómo estás?', piece: '¿cómo estás?' },
]);
```

Also prove blocked ownership imports no runtime, missing WebGPU/Web Locks is unsupported, failed warmup disposes and retries, overlapping chat is rejected, non-persisted `pagehide` disposes, and persisted `pagehide` does not.

- [ ] **Step 2: Run and verify RED**

```bash
npx playwright test tests/gemma-runtime.spec.js tests/ai-chat.spec.js tests/my-words.spec.js --project=chromium
```

Expected: new lifecycle/stream assertions fail.

- [ ] **Step 3: Implement minimal state and generation translation**

Use:

```js
const STATUS_MAP = {
  idle: 'idle', acquiring: 'loading', loading: 'downloading',
  warming: 'loading', ready: 'ready', blocked: 'blocked',
  releasing: 'loading', error: 'error',
};
```

Translate upstream progress into `phase`, `progress`, and `progressText`; compute appended text from each yielded full snapshot; pass `maxTokens` as `maxNewTokens`; reset before each independent Hablavos completion; reject concurrent generation; install source page lifecycle disposal.

- [ ] **Step 4: Update existing integration stubs**

Change AI chat and My Words stubs from `1.2B`/731 MB to `gemma-4-e2b`/Gemma 4 E2B/2400 MB and remove selection methods. Retain stub token streaming.

- [ ] **Step 5: Verify GREEN**

Run the focused Chromium tests and require all to pass without page errors.

### Task 4: Remove Model Selection And Background Loading

**Files:**
- Modify: `app.js`
- Modify: `tests/gemma-runtime.spec.js`
- Modify: `tests/app.integration.spec.js`

- [ ] **Step 1: Add failing UI tests**

Authenticate, open Settings, and assert:

```js
await expect(page.getByText('Gemma 4 E2B')).toBeVisible();
await expect(page.getByText('~2.4 GB first download')).toBeVisible();
await expect(page.getByText('Bigger models answer better')).toHaveCount(0);
await expect(page.locator('[data-fid="ai-model-option"]')).toHaveCount(0);
```

Assert login/navigation never calls `AI.ensureLoaded`, while opening the tutor calls it once.

- [ ] **Step 2: Run and verify RED**

Expected: Settings still renders size buttons and desktop login starts background loading.

- [ ] **Step 3: Implement fixed-model UI**

Remove `maybeStartAI()` and all `AI.setModelSize` usage. Replace `settings.ai.options` with fixed model values and render a static row. Change status copy to explicit-demand loading on every platform. Preserve demand loading from `openChat()` and `suggestMyWord()`. Map blocked, unsupported, progress phases, warmup, ready, and error into current surfaces.

- [ ] **Step 4: Verify GREEN**

Run `tests/gemma-runtime.spec.js` and `tests/app.integration.spec.js` on Chromium.

### Task 5: PWA Caching, Attribution, And Documentation

**Files:**
- Modify: `sw.js`
- Modify: `README.md`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `docs/gemma-runtime-preparation.md`
- Modify: `.gitignore`
- Test: `tests/gemma-runtime.spec.js`

- [ ] **Step 1: Add a failing service-worker test**

After activation, inspect the cache and assert every local runtime module, patch, manifest, and vendor asset is cached, with no cross-origin runtime/model URL.

- [ ] **Step 2: Run and verify RED**

```bash
npx playwright test tests/gemma-runtime.spec.js --project=chromium -g "runtime assets"
```

Expected: FAIL because `sw.js` lacks runtime assets.

- [ ] **Step 3: Update deployment and docs**

Bump `CACHE_NAME`, add local runtime dependencies to `APP_ASSETS`, and keep cross-origin requests outside service-worker interception. Adapt upstream notices/preparation docs with exact hashes and prohibition on committing generated bundles. Document one-model behavior, WebGPU/Web Locks/secure-context/OPFS requirements, approximately 2.4 GB first download, demand loading, and exclusive-tab ownership. Ignore `gemma-4-e2b.js`, `*.pretty.js`, and `_site/`.

- [ ] **Step 4: Verify GREEN and stale-reference removal**

```bash
git diff --check
rg -n "LiquidAI|LFM2|wllama|350M|700M|1\.2B|setModelSize" ai.js ai-runtime app.js index.html sw.js README.md THIRD_PARTY_NOTICES.md
```

Expected: no stale production references except explicitly labeled history.

### Task 6: Full Verification, Real Browser Flow, Commit, And Deploy

**Files:**
- Modify only files required by verification failures.

- [ ] **Step 1: Run complete test suites**

```bash
node --test tests/upstream-runtime/*.test.mjs
npx playwright test
```

Expected: all upstream tests and all Hablavos specs pass on Chromium and WebKit.

- [ ] **Step 2: Validate with the real testing account**

Load `.env` without printing values, start the static server, set `localStorage.spanishApiBase`, and log in using `[data-fid="auth-email"]` and `[data-fid="auth-password"]`. Exercise Home, Study, Quiz, Settings, Lexicon, My Words, and tutor loading. Confirm one Gemma 4 model, approximately 2.4 GB first download, and no selector.

When WebGPU, bandwidth, storage, and time permit, reach ready and generate a short Spanish response. Otherwise verify the real runtime request, hash/patch stages, lifecycle state, and explicitly report that full inference was not completed.

- [ ] **Step 3: Inspect scope**

```bash
git status --short
git diff --check
git diff --stat
```

Confirm existing `docs/go-forward-plan.md` and `docs/project-status.md` changes remain untouched and unstaged.

- [ ] **Step 4: Commit implementation**

Stage only implementation-owned files. The detailed commit records source commit, architecture, TDD red/green evidence, Chromium/WebKit results, real-account flow, runtime/model verification depth, and environmental limits.

- [ ] **Step 5: Push and smoke-test production**

Push the current branch, confirm GitHub Pages deployment, and smoke-test `https://moremeetings2.github.io/guatemala-spanish-3000-study-app/`.

