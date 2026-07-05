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
- `app.js`: main client app logic, persistence, quiz, review, speech, import/export, accounts + progress sync
- `api.js`: backend API client (base URL overridable via `localStorage.spanishApiBase`); loaded before `app.js`
- `ai.js`: on-device AI tutor engine — wraps wllama (llama.cpp WASM) running LiquidAI LFM2 GGUF models fully in the browser, cached in OPFS. Exposes `window.AI` (loaded before `app.js`). Default model 1.2B; 350M/700M/1.2B selectable in Settings. Downloads in the background after login (skipped on data-saver until chat is opened). Tests set `window.__NO_AI__ = true` to prevent the model download.
- AI chat: a full-screen overlay (`renderChat`, `#chat-sheet`) opened from the Home "AI tutor" card (general) or context buttons on study cards, the reader, and lexicon entries (each preloads a context-specific system prompt). Streams tokens; shows a one-time model-download progress bar when not yet ready.
- Auth/landing: signed-out users see the marketing landing page (Log in / Sign up). An account is required to use the app; logged-in users sync progress to the backend. Session stored in `localStorage.spanishAuth.v1`.
- `sw.js`: service worker for offline caching
- `manifest.webmanifest`: PWA manifest
- `data/guatemala_spanish_study_pack.json`: study content data
- `data/synonyms.json`: Spanish synonyms for Main 3000 words (shown on flashcards)
- `data/sentences.json`: example sentences for all 3000 Main 3000 words (the "Use" button); top ~150 hand-authored, rest generated
- The "You" tab includes a Guatemalan Lexicon reference view (`renderLexicon`, route `lexicon`) showing each term with its example sentence
- `tests/app.integration.spec.js`: Playwright integration tests for the core app (home, browse, study, quiz, settings, persistence, legacy migration, service worker) — current UI
- `tests/study-card-enrichments.spec.js`: Playwright tests for synonyms + example-sentence card features and the Lexicon view (current UI)
- `tests/auth.spec.js`: Playwright tests for the accounts/landing flow (landing, signup, login, logout, no-guest gating) with a mocked backend
- `tests/ai-chat.spec.js`: Playwright tests for the AI tutor chat (general + vocab-card context) with a stubbed `window.AI` (no real model download)
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
- Also run `npm run test:integration` when useful for full regression coverage.

## Debugging And Repro

- If a user says an issue still exists after a fix attempt, use the Browser MCP to reproduce it yourself against the real app.
- Real app URL for repro: `https://moremeetings2.github.io/guatemala-spanish-3000-study-app/`
- Do not assume a bug is fixed until you can reproduce or disprove it in a real browser flow.

## Communication Rules

- Explain technical topics simply. Assume the user is not a developer.
- When adding a new feature, ask interactive questions first and do not make assumptions about expected behavior.
- Confirm unclear product details with the user before implementing feature behavior.
