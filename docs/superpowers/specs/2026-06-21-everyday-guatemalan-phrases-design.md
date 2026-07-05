# Everyday Guatemalan Phrases Design

## Goal

Add a separate `Everyday Guatemalan Phrases` deck with 100 common casual conversation phrases that lean Guatemalan, keep Spanish on the front and English on the back, and make the deck searchable and selectable in the existing app UI.

## User-Visible Behavior

- The deck appears as its own option in the deck selector.
- The deck contains exactly 100 cards.
- Each card behaves like the existing phrase cards: tap Spanish to flip and reveal English.
- Search and filtering work the same way they do for the other phrase decks.

## Content Rules

- The deck is conversational and casual rather than formal or textbook-heavy.
- The phrasing should lean Guatemalan where natural, while still staying broadly understandable.
- The user-provided phrases are included, with Spanish normalized where needed so the cards read naturally.
- The rest of the list is filled out to 100 cards with common daily-use phrases.

## Implementation Approach

- Store the new phrase list in a committed source file under `data/` so it is maintainable.
- Extend the existing study-pack build script to import the new source file into the generated `guatemala_spanish_study_pack.json`.
- Add the new collection to the deck selector and hero counts.
- Reuse the existing phrase-card rendering path instead of adding new interaction logic.

## Testing

- Add a Playwright integration test that verifies the new deck is visible in the UI.
- Verify that selecting the deck shows 100 cards.
- Verify that a known Spanish phrase flips to the expected English translation.
- Verify that search finds entries from the new deck.
