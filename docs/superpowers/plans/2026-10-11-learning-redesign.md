# Hablavos Learning Redesign Implementation Plan

**Goal:** Ship the approved five-section learning app and a concise family brief.

**Architecture:** Keep app.js as the persistence/auth/study engine. Add learning.js
for navigation, focused practice, saved collections, countries, and verb lessons;
learning.css supplies the authenticated responsive shell. Preserve legacy route
entry points and all content IDs.

**Tech stack:** Vanilla JavaScript, CSS, PWA cache, Playwright Chromium/WebKit.

## Execution checklist

- [x] Add tests/learning.integration.spec.js. Through buttons/selects, assert
  five tabs; words versus phrase deck isolation; Spanish reveal/listen; unlimited
  advancement; independent lane resume; country persistence and account reset;
  hablar/poder tense/person examples and answer feedback; saved cards; no ads.
- [x] Run the new tests headed in the VM against the unchanged app and retain
  the missing-navigation failure as the red phase.
- [x] Add learning.js/learning.css. Hook authenticated render/navigation and
  persisted practice snapshots into app.js; include/cache both assets. Reuse
  grade, speak, toggleStar, filterCards, renderStudy, renderQuiz, and renderBrowse.
- [x] Add deterministic beginner-to-intermediate verb content in the UI module,
  with complete examples and answers for the offered persons/tenses. Keep this
  module independent of the optional multi-gigabyte AI model.
- [x] Update existing UI assertions only where navigation/home intentionally
  changes. Preserve behavior assertions and add UI coverage for old entry points.
- [x] Run targeted tests, then the complete headed suite with two workers.
  Inspect desktop/mobile screenshots and test the live backend login flow.
- [x] Create docs/hablavos-product-and-business-brief.docx and its editable
  source. Render and inspect every page. Update README/AGENTS and bump sw.js.
- [x] Review diff and git status, commit only task files with detailed evidence,
  push main, verify deployed assets and real browser flow, and report results.

VM command convention: run the guest's Node with PATH containing its bundled
Node and Python runtimes, change directory in Node to the Home shared-folder
path, and require the project's Playwright CLI. All headed browser processes
must run in the guest, never on John's host desktop. The host apply_patch tool
edits the one shared working copy; compare hashes before testing.

## Verification before publication

- October 11: final complete headed Chromium/WebKit run in VM AI Projects:
  **166 passed (3.0m)**. Full output: ignored `test-results/final-headed.log`.
- Red-to-green coverage includes navigation, country-aware tutor/My Words
  prompts, keyboard focus after render, and removal of a word saved both from
  reading and from starred cards. Real offline tests stop the origin server.
- Local redesign tested against the real API in headed Chromium and WebKit:
  login, resume, pronunciation controls, progress sync, quiz, lessons, country
  selection, My Words, admin CRUD, reading, and phone layouts. Temporary records
  were removed and touched card progress restored.
- Read-only review findings were fixed and covered by browser regression tests.
  Both pages of the Word brief were rendered and visually inspected.

## Publication verified

- Release commit `1c10c41815fe3bd142ca2426f918b634364195a1` was fast-forwarded
  to `main` and pushed. GitHub Pages reported `built` at
  `2026-10-12T02:27:12Z` (October 11 in Guatemala).
- Production `index.html`, `app.js`, `learning.js`, `learning.css`, and `sw.js`
  hashes all matched the tested files; the service worker is `hablavos-v43`.
- `tools/verify_learning_live.cjs https://hablavos.com chromium` and the same
  command for `webkit` both passed headed inside VM AI Projects. They exercised
  real login, independent card resume, pronunciation controls, grading/sync,
  quiz, lessons, country choice, My Words, admin CRUD, saved-word removal,
  keyboard focus, reading, and phone layouts. Both runs confirmed temporary
  records were deleted and touched progress restored.
- Production desktop and phone screenshots were inspected. Logs and images
  remain ignored under `test-results/production-*.log` and
  `test-results/live-learning/hablavos.com-*/`.
- Ads remain off. No ad-provider integration or optional AI model-quality test
  is claimed. The existing unrelated document deletion and Google Docs
  shortcuts remain outside the release.
