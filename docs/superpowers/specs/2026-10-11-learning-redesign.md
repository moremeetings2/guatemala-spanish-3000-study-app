# Hablavos learning redesign

Approved direction: John's October 11 request and the earlier interactive
mockup. Implement in the existing repository, not a second app or clone.

## Experience

- Home, Words, Phrases, Verbs, Library form the main navigation. Keep the
  Hablavos green identity, Nunito/Lora typography, and a calm mobile-first layout.
- Home prioritizes two choices: words or phrases. Practice has no daily cap.
- Words offers Main 3000 and Essential 200. Phrases offers Everyday Speaking
  (636 cards) and Everyday Conversation (230). Retain all existing decks in Library.
- Each practice area offers Study, Browse, and Quiz. Spanish is the default
  face; English appears on reveal. Preserve explicit direction preferences,
  pronunciation, examples, stars, and tutor access. Add Review again/I knew it
  actions using the existing spaced-repetition rules. Preserve each area's
  current card and collection across navigation and reopening.
- Verbs launches with accurate, hand-authored hablar and poder lessons, covering
  present, completed past, background past, and ir + a future plans. Include
  person selection, spoken examples, and contextual answer checking. Describe
  this honestly as a starter collection, not a complete grammar course.
- Country selection offers Shared Spanish plus the existing 21 references.
  It changes regional reference/tutor context, not the shared core deck or IDs.
  Save the choice per account. No claim of 21 complete courses or native audio.
- Library exposes reading, saved cards, all decks, My Words, country references,
  and tutor access. Account/progress/settings stay reachable separately.
- Preserve accounts, progress sync, offline study, imports/exports, and all card
  IDs. Leave the signed-out welcome page unchanged.

## Business and scope

Core learning stays free and unlimited. No live advertising SDK, tracking,
placeholder ad boxes, paywall, or affiliate link is added. Future sponsors or
ads belong on substantial lessons/reading, not answer controls or interruptions.
Network approval, consent, content-rights review, and sponsor agreements are
separate launch gates. Current regional text is already cached for offline use;
do not pretend to download separate country packs that do not yet exist.

Create a short Word brief explaining the learning design, revenue approach,
maintenance needs, and questions for John's son. Do not promise passive profit.

## Architecture and acceptance

Add a focused learning UI module and stylesheet; retain the existing state,
auth, speech, data, and sync engine. Store new preferences in account-scoped
snapshots, reset them on logout, and preserve legacy sessions. New routes must
have working back navigation, keyboard controls, empty states, and mobile layouts.

Write failing browser tests first. Verify real UI navigation, lane isolation,
resume, country/account isolation, lessons, audio dispatch, and no ad requests.
Run the complete Chromium/WebKit suite headed inside VM AI Projects. Verify
with the live testing account, remove test side effects, commit only this work,
push production changes, and verify the deployed version. Check shared-file
freshness before VM test runs; never use the stale Hablavos shortcut for Git.
