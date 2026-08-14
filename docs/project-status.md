# Hablavos — Project Status

*Snapshot: 2026-08-13 · living project plan and execution status*

**Hablavos** ("Learn the Spanish people actually speak") is live at **hablavos.com** — a free, account-gated PWA teaching the Spanish actually spoken in Guatemala, with the whole Spanish-speaking world on the roadmap.

---

## Where we are today (shipped & live)

| Area | State |
|---|---|
| **Core learning** | 3,000-word Main deck with spaced repetition, synonyms, and example sentences; **230-card Everyday Conversation** deck; **369-card Guatemalan Lexicon** including the 13 Guatemala usage notes; **Most Common in Guate** dynamically built from each learner's starred lexicon cards; **75 graded reading stories** with comprehension checks; quizzes |
| **Accounts** | Email + password accounts (**required — no guest mode**), cross-device progress sync, Cloudflare Workers + D1 backend (~$5/mo, serverless). Endpoints live: `/api/auth`, `/api/words`, `/api/progress`, `/api/my-words`, `/api/health` |
| **AI tutor** | One fixed on-device **Gemma 4** WebML/WebGPU model, using the tested browser runtime imported from `gemma-4-webml-webgpu`. The model is cached locally after a one-time ~2.4 GB download and runs in Safari and Chromium without a server inference bill. General and context-aware chat are available throughout the app. |
| **My Words** | Per-user private deck (cap 500), synced, wired into Study / Quiz / Browse / progress / AI-chat, with AI-drafted meanings + example sentences ("Fill in the rest with AI") |
| **Country Lexicons** | **All 21 Spanish-speaking countries** browsable in-app with flags, categories, example sentences, audio, and country-aware AI chat — free for every member. **2,644 entries total**: Guatemala 369 (356 lexicon entries + 13 merged usage notes, all studyable) + **2,275** across the other 20 (tiered: 150 each for MX/CO/VE/CL/AR/ES, 149 PE, 100 each for the 12 standard-tier countries, 26 for Equatorial Guinea — small on purpose per the quality bar) |
| **Marketing** | Responsive landing page (mobile + desktop) with the full 21-country roadmap grid |
| **Quality** | **112 Playwright tests** across Chromium + WebKit plus **62 runtime tests**; production runtime MIME smoke tests; auto-updating service worker; deployments verified at `hablavos.com` |

**Costs today:** ~$5/mo (Cloudflare) + domain. AI tutor is $0/user (on-device). No other recurring spend.

---

## Strategy we've agreed on

1. **Own a niche the giants ignore** — country-authentic Spanish, one region at a time.
2. **Generous free tier** — word-adding and lexicons stay free; what users add and search-but-don't-find becomes the **data flywheel** that curates future country modules.
3. **Monetize convenience, not the core** (later) — a Plus tier around unlimited AI, no ads, and all country courses.
4. **The long game** — once the Spanish-for-English-speakers engine is proven country by country, flip it to **English for Spanish speakers** in the same countries.

---

## Next steps (agreed priorities)

### Now → next few weeks — Content depth & trust
- [ ] **Native-speaker review passes** before promoting/launching any country's module (order: Mexico → Colombia → Argentina). This is the trust bar the brand needs. **Deferred:** do not hire reviewers or begin paid review work until John explicitly authorizes it.
- [x] Turn the Guatemala lexicon→module flow into a repeatable checklist (word list → sentences → stories → lexicon → native review → launch). See [country-module-checklist.md](./country-module-checklist.md).

#### Deferred native-review budget

The firm planning ceiling is **$250 USD per country**: Mexico $250, Colombia $250, and Argentina $250, for a **$750 USD total ceiling**. The recommended authorization sequence is a $250 Mexico pilot followed by $500 for Colombia and Argentina after the pilot passes its quality check.

Each country quote covers one native reviewer, up to 150 entries and six reviewer hours, row-by-row decisions and corrections, naturalness/register/regional-authenticity notes, one reconciliation check, platform-fee allowance, and a target turnaround of five business days. It excludes audio recording, new lessons, a second independent reviewer, and entries added after review starts. The selected freelancer must provide the final binding vendor quote.

**Next executable milestone when resumed:** build the country-lexicon validator and review-packet generator, then use them to prepare Mexico's native-speaker review packet. Do not spend against the review budget or promote Mexico as a launched course until review work is explicitly authorized and completed.

### Next — Retention & habit
- [ ] **Daily practice reminders** via PWA push notifications (iOS 16.4+ installed PWAs) — cheapest retention win available.
- [ ] **Guided learning path** — unit sequencing over existing content so beginners aren't dropped into 3,000 loose cards.
- [ ] **Placement quiz** on first launch to start users at the right depth.

### Then — Speaking (the #1 competitive gap)
- [ ] **"Speak" mode** — voice conversation with the on-device tutor (browser speech recognition + in-character replies + spoken responses). Duolingo Max's flagship ~$30/mo feature, free and private here.
- [ ] Pronunciation feedback on flashcards.
- [~] **Feasibility gate:** iPhone Safari keyboard dictation works, but the installed Home Screen PWA did not expose Web Speech recognition and showed unreliable keyboard dictation while Gemma was resident. Reinstall/update behavior and the no-persistence chat path are shipped; physical-device validation remains required. Android Chrome is still untested. Do not begin full Speak mode until both platforms pass a documented device matrix.

### Recently completed — Gemma 4 browser runtime
- [x] Replace the previous selectable LiquidAI models with one fixed Gemma 4 model and browser harness.
- [x] Add Safari-safe JavaScript module delivery, iOS memory/range-loading controls, OPFS-backed model caching, lifecycle ownership, and retry behavior.
- [x] Repair installed-PWA cache updates and remove unnecessary persistence work from the iPhone chat-input path.
- [x] Restore the active flashcard after an iPhone study session is closed and reopened.
- [x] Verify the production runtime graph and automated Chromium/WebKit coverage.

### Ongoing — Admin & operations
- [ ] **In-app admin word manager** (API already supports it) — add/edit/delete catalog words without touching code.
- [ ] **Automated weekly D1 backup** to Google Drive (beyond D1's built-in 30-day recovery).
- [ ] **Abuse hardening** — rate limiting on signup / login / my-words, basic monitoring & alerting.

### Later — Distribution & monetization
- [ ] App-store presence via a thin Capacitor wrapper (discoverability, reviews, trust).
- [ ] Introduce **Hablavos Plus** (~$4.99/mo, regional LatAm pricing) once retention is proven.

### The horizon — Country modules & the flip
- [ ] Launch country module **#2 → Mexico** (biggest market, deepest lexicon already built), then Colombia → Argentina → Costa Rica.
- [ ] With 3–4 modules live and the engine proven, build **Hablavos English** for Spanish speakers.

---

## Standing quality policy

- AI-authored entries must be **well-documented, high-confidence** regionalisms — deliver fewer rather than stretch. Every batch passes schema validation, category whitelist, and per-country de-duplication.
- **Attribution honesty** — pan-regional terms are fine when genuinely common in the labeled country; invented attributions never are.
- Equatorial Guinea stays small on purpose.
- **Every country module launch requires a native-speaker review first.**

## Operating rhythm

- Every completed chunk: detailed commit → deploy → docs updated → verified live.
- Full Playwright suite green on Chromium + WebKit before every deploy.
- Live validation with the admin test account for backend-touching changes; test data always cleaned up.
