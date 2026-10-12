# AGENTS.md

## Project

- Only active repo location: `/Users/johnmoore/Documents/GitHub/guatemala-spanish-3000-study-app`
- This project should not have multiple repo folders on this machine.
- Do not use or reference the older mixed-location folder: `/Users/johnmoore/Documents/AI Candidate Research Jared and Nia/guatemala_spanish_study_app`
- GitHub repo: `https://github.com/moremeetings2/guatemala-spanish-3000-study-app`
- GitHub Pages app: `https://moremeetings2.github.io/guatemala-spanish-3000-study-app/`
- App type: static iPhone-friendly PWA for studying Guatemala Spanish
- Brand: **Hablavos** ("Learn the Spanish people actually speak") — green `#28b573` "h" wordmark. Signed-out users land on a full marketing landing page (`renderLanding`, `authView: 'landing'`); Log in / Sign up open the auth form (`renderAuthForm`). **Accounts are required** — there is no guest mode; the app is gated behind login (`showAuth = !authed`).

## Repo Structure

- `index.html`: app shell and UI markup
- `styles.css`: app styling
- `learning.js`, `learning.css`: authenticated Home / Words / Phrases / Verbs / Library shell. Words and Phrases each save their exact card and collection under account-local `practice` snapshots. Library exposes all collections and resume of the last filtered/legacy session; header exposes settings. Landing/auth is unchanged.
- Country focus (`settings.country`, default `shared`) is account-local and updates tutor context/reference selection, not core card IDs, audio accents, or verb conjugations. The 21 country collections are references, not full courses; no simulated pack downloads. Verbs starts with hablar/poder, four tense patterns, and yo/tú/usted.
- Live ads remain OFF. `MONETIZATION` is a disabled policy declaration, not an ad-provider integration. Never introduce ad requests, blank slots, or practice limits without an approved provider/consent/content-rights implementation.
- `docs/hablavos-product-and-business-brief.docx` and its Markdown source: short family-facing design/revenue brief; rebuild with `tools/build_business_brief.py` and render/inspect before delivery.
- `app.js`: main client app logic, persistence, quiz, review, speech, import/export, accounts + progress sync
- Study persistence includes the active card ID and owning account ID. Closing and reopening an iPhone/PWA study session must resume the same card even though the surrounding order is reshuffled at boot; account-scoped My Words cards resume after `loadMyWords` completes. Separate per-account snapshots retain local-only reading/resume history across logout, and delayed API responses must never mutate a signed-out or different account.
- `api.js`: backend API client (base URL overridable via `localStorage.spanishApiBase`); loaded before `app.js`
- `ai.js`: synchronous facade for the vendored Gemma 4 WebGPU harness in `ai-runtime/`. It exposes `window.AI` before `app.js`, then defers the hash-pinned runtime and the single `google/gemma-4-E2B-it-qat-mobile-transformers` model until explicit tutor or My Words AI-assist use. The first model download is approximately 2.4 GB. Web Locks permit only one owning tab; Safari uses the copied memory-safe range/OPFS profile. There is no model selector. Tests set `window.__NO_AI__ = true` to prevent model loading.
- AI chat: a full-screen overlay (`renderChat`, `#chat-sheet`) opened from the Home "AI tutor" card (general) or context buttons on study cards, the reader, and lexicon entries (each preloads a context-specific system prompt). Streams tokens; shows a one-time model-download progress bar when not yet ready.
- Auth/landing: signed-out users see the marketing landing page (Log in / Sign up). An account is required to use the app; logged-in users sync progress to the backend. Session stored in `localStorage.spanishAuth.v1`.
- `sw.js`: service worker for offline caching
- `manifest.webmanifest`: PWA manifest
- `data/guatemala_spanish_study_pack.json`: study content data
- `data/synonyms.json`: Spanish synonyms for Main 3000 words (shown on flashcards)
- `data/essential_200.json`: canonical 200-word starter deck and companion spreadsheet content. Reuses 190 Main 3000 IDs with shared progress and adds ten `essential-*` IDs; preserve exactly 200 unique words. Access via Words collection picker or Library. Examples and quiz distractors stay within this deck. Total built-in unique cards: 4,245.
- `data/everyday_speaking.json`: 636 public cards covering 645 distinct transcript prompts; the default Phrases collection. Spanish first, reveal English, Listen on either face, optional English first saved per deck in `settings.studyDirections`. No voice recording/grading. Preserve `speaking-*` IDs. Source review: `docs/everyday-speaking-source.md`; tests: `tests/everyday-speaking.spec.js`.
- `data/sentences.json`: example sentences for all 3000 Main 3000 words (the "Use" button); top ~150 hand-authored, rest generated
- Library and its Progress screen expose **Everyday Conversation** (230 cards), **Guatemalan Lexicon** (369), and **Most Common in Guate** (the learner's starred lexicon cards). Preserve source collection IDs and card IDs; `app.js` maps source collections into these product decks without losing synced progress.
- Country references open from Library or the header; `renderLexicon`/route `lexicon` retains search, audio, country chips, and country-aware chat. Guatemala has 369 studyable cards; `data/country_lexicons.json` adds 2,275 reference entries across 20 countries. Regionalisms must be high-confidence/documented; deliver fewer rather than stretch. Native-speaker review is required before a country's module launch.
- Landing "Begin with Guatemala" module grid lists all 21 Spanish-speaking countries with flag emoji — collapsed to 4 with a "See all 21 countries" toggle (`landingMore` state)
- **My Words**: Library route `mywords`/`renderMyWords`; private D1 `user_words`, `/api/my-words` CRUD, cap 500/user. `loadMyWords`/`applyMyWords` merge account-owned cards into study/quiz/browse and clear them on logout. Optional `suggestMyWord` fills only empty meaning/example fields; chat and suggestions share one completion slot.
- `tests/app.integration.spec.js`: Playwright integration tests for the core app (home, browse, study, quiz, settings, persistence, legacy migration, service worker) — current UI
- `tests/learning.integration.spec.js`: real headed UI flows for separate unlimited practice, reveal/audio, per-lane resume, account-isolated country/bookmarks, verbs, saved cards, focused quizzes, no ads, and small-phone layout.
- `tests/learning-offline.spec.js`: real cache fallback with its isolated origin server stopped. WebKit's Playwright offline flag has an upstream service-worker bug; do not skip coverage or replace cached app behavior with stubs.
- `tests/study-card-enrichments.spec.js`: Playwright tests for synonyms + example-sentence card features and the Lexicon view (current UI)
- `tests/auth.spec.js`: Playwright tests for the accounts/landing flow (landing, signup, login, logout, account isolation, no-guest gating) with a mocked backend
- `tests/ai-chat.spec.js`: Playwright tests for the AI tutor chat (general + vocab-card context) with a stubbed `window.AI` (no real model download)
- `tests/my-words.spec.js`: Playwright tests for the My Words custom deck (boot load, add, duplicate rejection, delete, logout clearing) with a mocked backend
- `tools/generate_synonyms.py`: regenerates `data/synonyms.json` from WordNet (NLTK)
- `playwright.config.js`: Playwright config
- `tools/build_study_pack_from_csv_sources.py`: rebuilds study-pack data from CSV sources
- `backend/`: Cloudflare Workers + D1 API (accounts, admin word management, progress sync), deployed at `https://spanish3000-api.john-moore.workers.dev`. The frontend (GitHub Pages) calls it via `api.js`. See `backend/README.md` for the deploy runbook.
- `.env` (gitignored): admin/testing account credentials — see "Admin & Testing Account" below. `.env.example` is the committed template.
- `tools/extract_guatemala_spanish_workbook.py`: legacy workbook extraction helper
- `README.md`: setup, testing, and project overview

## Admin & Testing Account

There is a dedicated **admin + testing account** for validating features against the real backend. Its credentials live in the gitignored `.env` at the repo root:

- `ADMIN_EMAIL`, `ADMIN_PASSWORD` — the admin account (auto-granted admin because the email matches the Worker's `ADMIN_EMAIL` secret)
- `API_BASE` — the deployed API base URL

**Every agent working on this app MUST use this account to auto-login and validate its work in a real browser flow before finishing:**

1. Load the credentials from `.env` (e.g. `set -a; source .env; set +a`). Never hardcode or print the password; never commit `.env`.
2. In the browser (preview/Browser MCP), point the app at the API with `localStorage.setItem('spanishApiBase', <API_BASE>)`, then log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` (fill `[data-fid="auth-email"]` / `[data-fid="auth-password"]`, click **Log in**).
3. **Exercise the feature you changed end-to-end** (and adjacent flows: study, quiz, progress sync, admin word add/edit/delete via the API, lexicon, settings).
4. **If anything is wrong, fix it and re-validate — do not finish with known-broken behavior.** Repeat until the flow works as expected.
5. Also run the Playwright suite (`npx playwright test`) — all specs must pass on Chromium and WebKit.

Cleanup rules when testing against the live API/DB:
- Delete any test words you create (the catalog must stay at its real counts).
- Neutralize any test progress you push to the admin account (reset touched cards to default) so the account stays clean.

## Development Rules

- Use TDD for all development work.
- Every real behavior change MUST update or add REAL integration tests.
- Integration tests must validate the work with REAL testing, not inspection-only reasoning.
- Prefer extending `tests/app.integration.spec.js` unless a new integration test file is clearly better.
- Use Playwright in HEADFUL mode for real browser-based verification when testing changes.
- Preferred real-browser command: `npm run test:integration:headed`
- On John's Mac, all headed browser work runs in **VM AI Projects**. Use its Home share at `/Volumes/My Shared Files/Home/Documents/GitHub/guatemala-spanish-3000-study-app`; no second checkout. Verify edited file hashes match the host before testing. Host file edits do not authorize host desktop browser control.
- `tools/verify_learning_live.cjs [origin] [chromium|webkit]` performs explicit real-backend UI verification with `.env`, restores only touched account progress, removes test words, and writes ignored screenshots. Run sequentially in the VM, never concurrently against the testing account.
- Also run `npm run test:integration` when useful for full regression coverage.
- Whenever an agent finishes a chunk of work, commit the completed work with a **highly detailed commit message** that explains the context, root cause or requirement, implementation details, tests run, and deployment/verification evidence.
- After committing a completed chunk, deploy or push the work through the appropriate project path so the live app is updated when the change is intended for production.
- Keep documentation up to date with behavior, setup, deployment, and testing changes made during the work.
- Add concise inline code comments when code is written to satisfy a spec, requirement, workaround, or non-obvious product rule that would not be clear from reading the code alone.

## Debugging And Repro

- If a user says an issue still exists after a fix attempt, use the Browser MCP to reproduce it yourself against the real app.
- Real app URL for repro: `https://moremeetings2.github.io/guatemala-spanish-3000-study-app/`
- Do not assume a bug is fixed until you can reproduce or disprove it in a real browser flow.

## Communication Rules

- Explain technical topics simply. Assume the user is not a developer.
- When adding a new feature, ask interactive questions first and do not make assumptions about expected behavior.
- Confirm unclear product details with the user before implementing feature behavior.
- John receives updates only in this Codex chat (including on iPhone). Do not send texts, emails, or other external notifications for this project unless he explicitly changes this preference.
