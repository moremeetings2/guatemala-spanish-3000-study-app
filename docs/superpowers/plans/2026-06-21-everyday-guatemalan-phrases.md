# Everyday Guatemalan Phrases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate 100-card everyday Guatemalan phrases deck that is generated into the app data and available through the existing study UI.

**Architecture:** Keep the new content as a standalone source file under `data/`, import it through the existing build pipeline, and expose it as one more phrase collection in the current deck selector and search path. Reuse the existing flashcard and list rendering for phrase cards.

**Tech Stack:** Static HTML, vanilla JavaScript, JSON data sources, Python build script, Playwright integration tests.

---

### Task 1: Add the failing browser test

**Files:**
- Modify: `tests/app.integration.spec.js`

- [ ] Add a Playwright test that expects a new `everydayGuatemalaPhrases` deck option, a `100`-card study summary, a known phrase on the front of the card, and a matching English translation after flipping.
- [ ] Run the targeted test with `npm run test:integration:headed -- --grep "everyday guatemalan phrases"` and confirm it fails because the deck does not exist yet.

### Task 2: Add the source content and build support

**Files:**
- Create: `data/everyday_guatemalan_phrases.json`
- Modify: `tools/build_study_pack_from_csv_sources.py`
- Modify: `data/guatemala_spanish_study_pack.json`

- [ ] Create a committed JSON source file with exactly 100 phrase records.
- [ ] Extend the build script so it imports the new source file into a dedicated `everydayGuatemalaPhrases` collection and updates metadata counts.
- [ ] Rebuild `data/guatemala_spanish_study_pack.json`.

### Task 3: Expose the new deck in the app

**Files:**
- Modify: `index.html`
- Modify: `app.js`

- [ ] Add the new deck to the deck selector.
- [ ] Add hero-stat support and collection labeling for the new deck.
- [ ] Ensure search and card metadata include the new collection and reuse the existing phrase rendering path.

### Task 4: Verify and publish

**Files:**
- Modify: `README.md`
- Verify: `tests/app.integration.spec.js`

- [ ] Update rebuild documentation if the new source file changes the data pipeline.
- [ ] Run `npm run test:integration:headed`.
- [ ] Run `npm run test:integration`.
- [ ] Stage only the app-related files, commit, and push `main` to GitHub.
