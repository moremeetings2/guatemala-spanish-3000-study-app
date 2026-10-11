# Spanish-First Study Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this approved change in the existing project checkout. Do not create a second repo.

**Goal:** Default Everyday Speaking to a Spanish-only phrase face, with Listen and English revealed on flip; retain optional English-first practice.

**Architecture:** Change the existing direction fallback rather than introduce another study mode or migrate progress. Preserve explicit per-deck language choices, stable card IDs, and immediate persistence. Leave the welcome page, bilingual reference lists, and example-sentence view unchanged.

**Tech Stack:** Vanilla JavaScript static PWA, device speech synthesis, Playwright Chromium and WebKit, GitHub Pages.

## Approved Behavior

The user approved Spanish on the front, Listen available, and English hidden until flipping. English-first remains optional. Spanish is the fallback for sessions without an explicit saved choice; an explicitly chosen English-first mode remains saved. The existing quiz follows the chosen direction.

## Steps

- [x] Update `tests/everyday-speaking.spec.js` to assert Spanish-first, hidden English, card/button reveal, Listen on both faces, next-card reset, and optional English-first persistence across reload and complete browser closure. Test quiz in both directions.

```js
await openDeck(page, 'Déjame ver');
await page.getByRole('button', { name: 'Study these', exact: true }).click();
const card = page.locator('[data-fid="study-card"]');
await expect(card).toContainText('Déjame ver.');
await expect(card).not.toContainText('Let me check.');
await page.getByRole('button', { name: 'Show English', exact: true }).click();
await expect(card).toContainText('Let me check.');
await expect(card).not.toContainText('Déjame ver.');
```

- [x] Run `npm run test:integration:headed -- tests/everyday-speaking.spec.js --grep 'defaults to Spanish' --workers=2`; confirm failure against the old English-first default.
- [x] In `app.js`, replace the deck-specific direction fallback with `return 'es-en';`, list Spanish first before English first, and make the Spanish-face hint `Flip for English if you need it.` Explicit saved choices still take precedence.
- [x] Update `README.md`, `AGENTS.md`, and the manifest description to explain the new default. Bump `sw.js` from `hablavos-v41` to `hablavos-v42`.
- [x] Run `node --check app.js`, `git diff --check`, and the entire headed integration suite with two workers. All 142 Chromium and WebKit tests passed.
- [x] Use the real testing account in a visible browser to verify Spanish-only front, hidden English until flip, native Spanish audio on both faces, both direction choices, complete browser relaunch, quiz, mobile layout, and sync. All passed locally against the real API; touched progress was restored.

## Publication Procedure

Commit only this change with detailed test evidence, push main, confirm Pages deployment, and repeat the real-account flow on `https://hablavos.com/`. Leave unrelated document changes untouched. Report the final production results after publication; the checks above describe pre-publication evidence.
