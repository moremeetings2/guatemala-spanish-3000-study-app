# Hablavos

**Learn the Spanish people actually speak.** Small static PWA (brand name **Hablavos**) built from the study-pack dataset, CSV-fed phrase content, a dedicated everyday-phrases source file, and a curated Guatemalan lexicon source file. Starts with Guatemala; more regions on the roadmap.

## What it does

- Includes Essential 200: a focused starter deck for everyday speaking, with Spanish example sentences and English translations
- Includes Everyday Speaking: 636 phrase cards from the complete supplied video transcript, with Spanish-first study, English revealed on flip, and Spanish pronunciation
- Loads the Main 3000, a 230-card Everyday Conversation deck, and a 369-entry Guatemalan Lexicon that includes the Guatemala usage notes
- Builds Most Common in Guate from the signed-in learner's starred Guatemalan Lexicon cards, sharing the same synced progress and star state
- Works as a mobile-first study app
- Stores separate per-account progress snapshots, spaced repetition, favorites, app preferences, and the active study card in browser storage so logout and account switching cannot mix learners' work
- Supports offline use through a service worker
- Adds pronunciation, quiz mode, due-today review, weak-card resurfacing, and progress import/export
- Lets you slow pronunciation down and choose the clearest available Spanish voice on the device
- Runs the Gemma 4 E2B tutor locally through WebGPU; prompts and replies stay in the browser

## Essential 200

Open **You → Essential 200**, then **Study these** or **Quiz these**. On a flashcard, tap **Use** to read and hear the example sentence. Quiz questions and answer choices stay within the essential vocabulary, including when search narrows the questions. Study sessions resume the active card after reopening the app.

`data/essential_200.json` is the canonical content for this deck and its companion spreadsheet: 200 unique words in ten practical categories, each with an English meaning and a Spanish/English example sentence. It reuses 190 Main 3000 IDs so those cards share progress, and adds ten missing basics with stable `essential-*` IDs. With Everyday Speaking, the app has 4,245 unique built-in cards; Main 3000 still contains exactly 3,000. Selected words use the manifest's reviewed meanings and examples throughout the app, including everyday senses such as *tienda* (store), *carro* (car), and *efectivo* (cash).

The selection favors everyday speaking needs over frequency alone. It includes Guatemala's **vos** alongside **tú**, formal **usted**, and plural **ustedes**. Examples sometimes conjugate the dictionary-form verb or inflect an adjective. This is a starting vocabulary, not a claim that 200 words cover every conversation.

Keep exactly 200 distinct words and IDs when editing the manifest. Retain existing IDs to preserve learner progress. The study-pack CSV rebuild does not overwrite this file. Export the `words` rows directly for the spreadsheet so its meanings and examples match the app. The service worker caches the manifest for offline sessions.

## Everyday Speaking

Open **You → Everyday Speaking → Study these**. The card starts with only the Spanish phrase. Read it or tap **Listen**, and try to understand it. If you get stuck, tap **Show English** (or the card) to reveal the meaning. **Listen** pronounces the Spanish on either face, using the voice and speed selected in Settings. **English first** remains optional for practicing recall in the other direction. The app does not record or grade your voice.

The first-language choice is remembered separately for each deck. All decks default to Spanish; an explicitly saved English-first choice is preserved until you select **Spanish first**. The active card and study preferences are saved immediately when changed, so closing the whole browser right after a tap does not lose the change. Backgrounding or closing the page also flushes pending updates. **Quiz these** follows the speaking deck's chosen direction and draws answer choices from the same deck. Bilingual reference lists and the welcome-page sample are unchanged.

`data/everyday_speaking.json` contains 636 cards representing all 645 distinct English prompts in the supplied full transcript. The video title advertises 650; repetitions and equivalent prompts are combined rather than padding the deck. Eighteen missing Spanish answers were supplied, and transcription/translation corrections are recorded in [the source review](docs/everyday-speaking-source.md). Regional wording is generally retained. The manifest is cached for offline use and uses stable IDs so future corrections and additions preserve progress.

## On-device AI tutor

Hablavos embeds the browser model harness from
`moorej2400/gemma-4-webml-webgpu` at source commit
`b3226e158bb78da66e5932e47ecf0401a5d8920b`. There is one model:
`google/gemma-4-E2B-it-qat-mobile-transformers`.

The first use downloads approximately 2.4 GB. Loading begins only when you open
the tutor or use AI assist in My Words. Later sessions may reuse the browser's
cache. The tutor requires HTTPS (or localhost), WebGPU, Web Locks, OPFS, enough
free storage, and enough available memory. Only one Hablavos tab can own the
model at a time, which prevents duplicate GPU allocation in Safari and Chrome.

The generated WebML runtime is not committed. The browser downloads an exact
hash-pinned upstream bundle, applies the checked-in Safari memory patch, verifies
the patched hash, and evaluates it locally. See
`docs/gemma-runtime-preparation.md` and `THIRD_PARTY_NOTICES.md`.

## Regenerate the app data

```bash
python3 ./tools/build_study_pack_from_csv_sources.py \
  ./data/guatemala_spanish_study_pack.json \
  /Users/johnmoore/Downloads/guatemala_fluency_phrases.csv \
  /Users/johnmoore/Downloads/spanish_3000_phrasebank.csv \
  ./data/guatemala_spanish_lexicon.json \
  ./data/guatemala_spanish_study_pack.json
```

This rebuild keeps the existing `mainWords` and `guatemalaBonus` base content, replaces the coffee collection from the fluency CSV, adds the conversation-verbs collection, imports everyday phrases from `data/everyday_guatemalan_phrases.json`, imports the Guatemalan lexicon from `data/guatemala_spanish_lexicon.json`, and enriches all 3,000 words with mini-phrase data. The source collection IDs remain separate for repeatable data builds; `app.js` consolidates them into the product-facing decks at load time.

Legacy bootstrapping:

```bash
python3 ./tools/extract_guatemala_spanish_workbook.py \
  /Users/johnmoore/Desktop/guatemala_spanish_3000_study_pack.xlsx \
  ./data/guatemala_spanish_study_pack.json
```

Use the workbook extractor only when the base word deck or Guatemala bonus content changes. The CSV merge step above is the required modern build path for phrase content.

## Run locally

From this directory:

```bash
python3 -m http.server 8000
```

Then open:

`http://localhost:8000`

## Integration tests

Install dependencies:

```bash
npm install
npx playwright install chromium webkit
```

Run the Playwright integration suite:

```bash
npm run test:integration
```

Use `npm run test:integration:headed` for visible browser verification on Chromium and WebKit.

The suite validates deck rendering, phrasebank search, study/review actions,
quiz flow, pronunciation controls, persistence, storage reconciliation,
import/export, and the Gemma runtime contract on Chromium and WebKit.

## iPhone use

Serve the folder from any static host, open it in Safari on iPhone, then use `Share -> Add to Home Screen`.

For better pronunciation quality on iPhone, install an enhanced Spanish voice in `Settings -> Accessibility -> Spoken Content -> Voices`, then select it in the app.
