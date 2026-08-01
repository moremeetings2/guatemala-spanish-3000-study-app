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
- `ai.js`: synchronous facade for the vendored Gemma 4 WebGPU harness in `ai-runtime/`. It exposes `window.AI` before `app.js`, then defers the hash-pinned runtime and the single `google/gemma-4-E2B-it-qat-mobile-transformers` model until explicit tutor or My Words AI-assist use. The first model download is approximately 2.4 GB. Web Locks permit only one owning tab; Safari uses the copied memory-safe range/OPFS profile. There is no model selector. Tests set `window.__NO_AI__ = true` to prevent model loading.
- AI chat: a full-screen overlay (`renderChat`, `#chat-sheet`) opened from the Home "AI tutor" card (general) or context buttons on study cards, the reader, and lexicon entries (each preloads a context-specific system prompt). Streams tokens; shows a one-time model-download progress bar when not yet ready.
- Auth/landing: signed-out users see the marketing landing page (Log in / Sign up). An account is required to use the app; logged-in users sync progress to the backend. Session stored in `localStorage.spanishAuth.v1`.
- `sw.js`: service worker for offline caching
- `manifest.webmanifest`: PWA manifest
- `data/guatemala_spanish_study_pack.json`: study content data
- `data/synonyms.json`: Spanish synonyms for Main 3000 words (shown on flashcards)
- `data/sentences.json`: example sentences for all 3000 Main 3000 words (the "Use" button); top ~150 hand-authored, rest generated
- The "You" tab includes a **Country Lexicons** reference view (`renderLexicon`, route `lexicon`): flag chips select any of the 21 Spanish-speaking countries. Guatemala (default) shows the studyable in-catalog lexicon deck (356 entries); the other 20 countries come from `data/country_lexicons.json` (2,275 authored entries — tiered: 150 for MX/CO/VE/CL/AR/ES, 149 PE, 100 for the 12 standard-tier countries, 26 for GQ — with categories + example sentences, loaded at boot into `data.COUNTRY_LEX`). Search, audio, and AI-chat (country-aware prompts) work per country. Content policy: high-confidence documented regionalisms only; agents deliver fewer rather than stretch; native-speaker review required before a country's module launch (see docs/go-forward-plan.md).
- Landing "Begin with Guatemala" module grid lists all 21 Spanish-speaking countries with flag emoji — collapsed to 4 with a "See all 21 countries" toggle (`landingMore` state)
- **My Words**: every signed-in user has a private custom deck (route `mywords` from the You tab; `renderMyWords`). Words are stored per-user in D1 (`user_words` table, `/api/my-words` CRUD, cap 500/user), fetched after login (`loadMyWords`) and merged into `data.CARDS` as deck `myWords` (`applyMyWords`), so Study/Quiz/Browse/progress/AI-chat all pick them up. Cleared from the catalog on logout. The add form has an AI assist (`suggestMyWord`, "Fill in the rest with AI"): the on-device tutor drafts the English meaning + example sentence from just the Spanish word via a one-shot-anchored, line-format prompt (tolerant regex parsing); it only fills fields the user left empty, and chat/suggest are mutually exclusive (one completion at a time on the shared engine).
- `tests/app.integration.spec.js`: Playwright integration tests for the core app (home, browse, study, quiz, settings, persistence, legacy migration, service worker) — current UI
- `tests/study-card-enrichments.spec.js`: Playwright tests for synonyms + example-sentence card features and the Lexicon view (current UI)
- `tests/auth.spec.js`: Playwright tests for the accounts/landing flow (landing, signup, login, logout, no-guest gating) with a mocked backend
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
