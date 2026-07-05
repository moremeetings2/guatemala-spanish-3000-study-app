# Hablavos

**Learn the Spanish people actually speak.** Small static PWA (brand name **Hablavos**) built from the study-pack dataset, CSV-fed phrase content, a dedicated everyday-phrases source file, and a curated Guatemalan lexicon source file. Starts with Guatemala; more regions on the roadmap.

## What it does

- Loads the main 3,000-word list, coffee-shop phrases, conversation verbs, an everyday Guatemalan phrases deck, Guatemala notes, and a Guatemalan lexicon deck
- Works as a mobile-first study app
- Stores progress, spaced repetition, favorites, and app preferences in an internal browser database using IndexedDB
- Supports offline use through a service worker
- Adds pronunciation, quiz mode, due-today review, weak-card resurfacing, and progress import/export
- Lets you slow pronunciation down and choose the clearest available Spanish voice on the device

## Regenerate the app data

```bash
python3 ./tools/build_study_pack_from_csv_sources.py \
  ./data/guatemala_spanish_study_pack.json \
  /Users/johnmoore/Downloads/guatemala_fluency_phrases.csv \
  /Users/johnmoore/Downloads/spanish_3000_phrasebank.csv \
  ./data/guatemala_spanish_lexicon.json \
  ./data/guatemala_spanish_study_pack.json
```

This rebuild keeps the existing `mainWords` and `guatemalaBonus` base content, replaces the coffee deck from the fluency CSV, adds the conversation-verbs deck, imports the everyday phrases deck from `data/everyday_guatemalan_phrases.json`, imports the Guatemalan lexicon deck from `data/guatemala_spanish_lexicon.json`, and enriches all 3,000 words with mini-phrase data.

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

The suite validates deck rendering, phrasebank search, study/review actions, quiz flow, pronunciation controls, IndexedDB-backed persistence, full relaunch durability, storage reconciliation, and import/export.

## iPhone use

Serve the folder from any static host, open it in Safari on iPhone, then use `Share -> Add to Home Screen`.

For better pronunciation quality on iPhone, install an enhanced Spanish voice in `Settings -> Accessibility -> Spoken Content -> Voices`, then select it in the app.
