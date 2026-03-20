# Guatemala Spanish 3000 Study App

Small static PWA built from `/Users/johnmoore/Desktop/guatemala_spanish_3000_study_pack.xlsx`.

## What it does

- Loads the main 3,000-word list plus coffee-shop phrases and Guatemala notes
- Works as a mobile-first study app
- Stores progress and favorites in browser local storage
- Supports offline use through a service worker

## Regenerate the app data

```bash
python3 ./tools/extract_guatemala_spanish_workbook.py \
  /Users/johnmoore/Desktop/guatemala_spanish_3000_study_pack.xlsx \
  ./data/guatemala_spanish_study_pack.json
```

## Run locally

From this directory:

```bash
python3 -m http.server 8000
```

Then open:

`http://localhost:8000`

## iPhone use

Serve the folder from any static host, open it in Safari on iPhone, then use `Share -> Add to Home Screen`.
