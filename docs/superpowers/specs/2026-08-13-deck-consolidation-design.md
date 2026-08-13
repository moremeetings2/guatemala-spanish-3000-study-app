# Deck Consolidation Design

**Date:** 2026-08-13

## Goal

Simplify the deck list in the signed-in **You** section by consolidating overlapping content and adding a focused deck for the user's starred Guatemalan vocabulary.

## Product Behavior

### Everyday Conversation

The existing Coffee Phrases (57 cards), Conversation (73 cards), and Everyday Phrases (100 cards) collections become one deck named **Everyday Conversation** with 230 cards.

The underlying content and card IDs remain unchanged. Existing study state, quiz history, stars, and synced backend progress therefore continue to address the same records.

### Guatemalan Lexicon

The existing Guatemala Notes collection (13 cards) joins the Guatemalan Lexicon collection (356 cards). The resulting **Guatemalan Lexicon** contains 369 entries.

Guatemala Notes retain their IDs and explanatory note text. In the lexicon reference view, a note is displayed as supporting usage information rather than discarded during data transformation.

### Most Common in Guate

**Most Common in Guate** is a derived deck containing cards that satisfy both conditions:

1. The card belongs to the merged Guatemalan Lexicon.
2. The signed-in user's progress record has `star: true` for that card ID.

The admin/testing account currently has no starred progress rows in the deployed backend, so repository code must not freeze an empty or guessed curated list. Deriving membership from stars lets the phone's existing local stars appear immediately and lets synced stars populate the deck on any device.

Starred cards remain in the full Guatemalan Lexicon. The derived deck does not clone cards or create new IDs. Studying, grading, or un-starring a card uses the same progress record everywhere. Un-starring a card removes it from Most Common in Guate on the next render.

The Most Common in Guate deck remains visible when empty so its purpose is discoverable.

## Data Model

The source JSON collections remain unchanged. `transformData` normalizes source collections into primary app decks:

- `coffeePhrases`, `conversationVerbs`, and `everydayGuatemalaPhrases` map to `everydayConversation`.
- `guatemalaBonus` and `guatemalaLexicon` map to `guatemalaLexicon`.
- `mainWords` and `myWords` retain their current behavior.

Most Common in Guate is a virtual deck evaluated by a single deck-membership helper using the current `cardState`. This keeps card objects canonical and prevents progress duplication.

## User Interface

The You section, Browse deck chips, Study sources, Quiz sources, and card counts use the normalized deck definitions:

- Main 3000
- Everyday Conversation
- Guatemalan Lexicon
- Most Common in Guate
- My Words, when the user has custom cards

The obsolete Coffee, Verbs, Everyday, and Notes deck choices no longer appear. The landing-page deck description is updated from Coffee Phrases to Everyday Conversation for consistency.

## Persistence And Sync

No backend schema or API changes are required. Existing card IDs and `cardState` records remain authoritative. Stars continue to sync through `/api/progress` as before.

Persisted Browse, Study, or Quiz filters that reference one of the retired deck IDs are normalized to the replacement deck:

- Coffee, Conversation, or Everyday filters reopen as Everyday Conversation.
- Guatemala Notes filters reopen as Guatemalan Lexicon.

## Testing

Playwright integration coverage must verify:

- The You section shows the consolidated deck names and exact fixed counts.
- Retired deck names are absent from the deck list and Browse chips.
- Everyday Conversation exposes cards from all three original collections.
- Guatemalan Lexicon exposes original lexicon cards and Guatemala Notes.
- Starring a Guatemalan Lexicon card adds it to Most Common in Guate without changing its ID or progress.
- Un-starring the card removes it from the derived deck.
- A retired persisted deck filter migrates to its replacement.
- Existing study, quiz, persistence, auth, AI, lexicon, and My Words suites remain green in Chromium and WebKit.

The completed change must also be exercised in a headed browser and against the deployed app using the admin/testing account, without leaving test progress behind.
