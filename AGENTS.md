# AGENTS.md

## Project

- Only active repo location: `/Users/johnmoore/Documents/GitHub/guatemala-spanish-3000-study-app`
- This project should not have multiple repo folders on this machine.
- Do not use or reference the older mixed-location folder: `/Users/johnmoore/Documents/AI Candidate Research Jared and Nia/guatemala_spanish_study_app`
- GitHub repo: `https://github.com/moremeetings2/guatemala-spanish-3000-study-app`
- GitHub Pages app: `https://moremeetings2.github.io/guatemala-spanish-3000-study-app/`
- App type: static iPhone-friendly PWA for studying Guatemala Spanish

## Repo Structure

- `index.html`: app shell and UI markup
- `styles.css`: app styling
- `app.js`: main client app logic, persistence, quiz, review, speech, import/export
- `sw.js`: service worker for offline caching
- `manifest.webmanifest`: PWA manifest
- `data/guatemala_spanish_study_pack.json`: study content data
- `data/synonyms.json`: Spanish synonyms for Main 3000 words (shown on flashcards)
- `data/sentences.json`: example sentences for all 3000 Main 3000 words (the "Use" button); top ~150 hand-authored, rest generated
- The "You" tab includes a Guatemalan Lexicon reference view (`renderLexicon`, route `lexicon`) showing each term with its example sentence
- `tests/app.integration.spec.js`: Playwright integration tests for the core app (home, browse, study, quiz, settings, persistence, legacy migration, service worker) — current UI
- `tests/study-card-enrichments.spec.js`: Playwright tests for synonyms + example-sentence card features and the Lexicon view (current UI)
- `tools/generate_synonyms.py`: regenerates `data/synonyms.json` from WordNet (NLTK)
- `playwright.config.js`: Playwright config
- `tools/build_study_pack_from_csv_sources.py`: rebuilds study-pack data from CSV sources
- `backend/`: Cloudflare Workers + D1 API (accounts, admin word management, progress sync). Frontend stays on GitHub Pages and calls this API. See `backend/README.md` for the deploy runbook. Not yet wired into the live app.
- `tools/extract_guatemala_spanish_workbook.py`: legacy workbook extraction helper
- `README.md`: setup, testing, and project overview

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
