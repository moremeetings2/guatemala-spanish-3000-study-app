# Hablavos — Go-Forward Plan

*Prepared July 2026 · living document — update as milestones land*

## Where we are today

Hablavos ("Learn the Spanish people actually speak") is live at **hablavos.com** — a free, account-based PWA teaching the Spanish actually spoken in Guatemala, with the full Spanish-speaking world on the roadmap.

**Shipped and live:**

| Area | Status |
|---|---|
| Core learning | 3,000-word Main deck with spaced repetition, synonyms, example sentences; Coffee/Everyday/Conversation phrase decks; 75 graded reading stories with comprehension checks; quizzes |
| Accounts | Email+password accounts (required — no guest mode), progress sync across devices, Cloudflare Workers + D1 backend (~$5/mo, serverless, zero maintenance) |
| AI tutor | On-device LLM (LiquidAI LFM2 via wllama/WASM) — private, free, offline-capable. General chat + context-aware chat on every vocab card, story, and lexicon entry. Device-aware model sizing (1.2B desktop / 350M mobile) with crash guard |
| My Words | Per-user custom deck (cap 500), synced, integrated into Study/Quiz/Browse, with AI-drafted meanings and example sentences ("Fill in the rest with AI") |
| Country Lexicons | All 21 Spanish-speaking countries browsable in-app with flags, categories, example sentences, audio, and country-aware AI chat — free for every member. **2,631 total entries**: Guatemala 356 (studyable deck) + 2,275 across the other 20 (tiered: 150 each for Mexico/Colombia/Venezuela/Chile/Argentina/Spain, 149 Peru, 100 each for the 12 standard-tier countries, 26 for Equatorial Guinea — kept small on purpose per the quality bar) |
| Marketing | Responsive landing page (mobile + desktop) with the full 21-country roadmap grid |
| Quality | ~70 Playwright integration tests on Chromium + WebKit; auto-updating service worker; every deploy verified live |

## Guiding strategy (agreed)

1. **Own a niche the giants ignore**: country-authentic Spanish, one region at a time. Nobody else builds "the Spanish people speak in ___" as a product.
2. **Generous free tier** — word-adding and lexicons stay free. Free personalization feeds the **data flywheel**: what users add (and search for but don't find) maps each country's missing vocabulary, writing future modules' curation lists for us.
3. **Monetize convenience, not the core** (when the time comes): a Plus tier around unlimited AI tutor, no ads, and all country courses — not around table-stakes features.
4. **The long game**: once the Spanish-for-English-speakers engine is proven country by country, flip it — **English for Spanish speakers**, launched into the same countries where the brand already has a beachhead. Same content, same infrastructure, vastly larger market.

## Phase plan

### Phase A — Content depth & trust (now → next few weeks)
- [x] Lexicons for all 21 countries — **done July 2026** (tiered: 150 deep-market / 100 standard / 26 Equatorial Guinea; 2,631 entries total incl. Guatemala)
- [ ] **Native-speaker review passes** — before promoting any country's lexicon or launching its module, a native speaker reviews it (Upwork/Fiverr, ~1 hour per country, prioritize Mexico → Colombia → Argentina). AI-authored content is strong on documented slang; native review is the trust bar the brand deserves.
- [ ] Grow Guatemala's lexicon-to-module playbook into a repeatable checklist (word list → sentences → stories → lexicon → native review → launch).

### Phase B — Retention & habit (next)
- [ ] **Daily practice reminders** via PWA push notifications (supported on iOS 16.4+ installed PWAs; the cheapest retention win in the industry).
- [ ] **Guided learning path** — "Unit 1: Greetings → Unit 2: The Market…" sequencing over existing content so beginners aren't dropped into 3,000 loose cards.
- [ ] Placement quiz on first launch ("How much Spanish do you know?") to start users at the right depth.

### Phase C — Speaking (the #1 competitive gap)
- [ ] **"Speak" mode**: voice conversation practice with the on-device AI tutor — user speaks Spanish (browser speech recognition), tutor replies in character (market vendor, taxi driver), app speaks back. This is Duolingo Max's ~$30/mo flagship feature, free and private in Hablavos.
- [ ] Pronunciation feedback on flashcards (speech-to-text match against the target word).
- [ ] Feasibility gate first: verify speech recognition quality on iPhone Safari + Android Chrome.

### Phase D — Admin & operations
- [ ] **Admin word manager** (in-app screen for the admin account) — add/edit/delete catalog words without touching code. The API already supports it and is verified.
- [ ] **Automated weekly backup** of the D1 database to Google Drive (belt-and-suspenders beyond D1's built-in 30-day point-in-time recovery).
- [ ] **Abuse hardening**: rate limiting on signup/login/my-words, basic monitoring/alerting.

### Phase E — Distribution & monetization
- [ ] App-store presence (thin Capacitor wrapper around the PWA) for discoverability, reviews, and trust.
- [ ] Introduce **Hablavos Plus** (~$4.99/mo) once retention is proven: no ads, unlimited AI tutor (free tier gets a daily allowance), all country courses. Regional pricing for LatAm.
- [ ] Light ads on the free tier only if/when scale justifies them — never at the cost of the calm brand.

### Phase F — Country modules & the flip
- [ ] Launch country module #2 (recommend **Mexico** — biggest market, deepest lexicon already built) using the Guatemala playbook.
- [ ] Repeat: Colombia → Argentina → Costa Rica (tourism) → …
- [ ] When 3–4 country modules are live and the engine is proven: build **"Hablavos English"** — the reverse-direction app for Spanish speakers, launched country by country where the brand already exists.

## Content quality policy (standing)

- AI-authored entries must be **well-documented, high-confidence** regionalisms; agents instructed to deliver fewer rather than stretch. Every batch passes schema validation, category whitelist, and per-country de-duplication.
- **Attribution honesty**: shared/pan-regional terms are acceptable when genuinely common in the labeled country; invented or dubious attributions are never acceptable — authenticity is the brand.
- Equatorial Guinea stays small on purpose; padding it would violate the trust bar.
- Every country module launch requires a **native-speaker review** of its content first.

## Operating rhythm

- Every completed chunk: detailed commit → deploy → docs updated → verified live (standing workflow).
- Full Playwright suite green on Chromium + WebKit before every deploy.
- Live validation with the admin test account for backend-touching changes; test data always cleaned up.
- User-added My Words data reviewed (anonymized, in aggregate) quarterly as curation signal for upcoming country modules — disclosed in the privacy policy before first use.

## Costs (current)

- Cloudflare Workers + D1: ~$5/mo (covers ~20k+ active users at current usage patterns)
- GitHub Pages hosting + hablavos.com domain: ~free + domain registration
- AI tutor: $0/user (on-device)
- Next real costs: native-speaker reviews (~$25–50/country), app-store developer accounts ($99/yr Apple, $25 once Google)
