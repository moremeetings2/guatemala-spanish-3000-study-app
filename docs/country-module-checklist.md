# Hablavos Country Module Checklist

Use this checklist for every country module. A country may appear in the free
reference lexicon before completing this process, but it must not be marketed
as a reviewed or launched course until every launch gate passes.

## 1. Scope and ownership

- [ ] Name the country, module owner, target launch date, and native reviewer.
- [ ] Record the source data file and exact entry count.
- [ ] Define the intended depth: reference lexicon only, standard module, or
      deep-market module.
- [ ] Open a tracking issue or document for rejected, disputed, and deferred
      terms. Never silently stretch the list to meet a target count.

## 2. Source vocabulary

- [ ] Use documented, high-confidence regional usage.
- [ ] Record a source URL or bibliographic reference for every regional claim.
- [ ] Distinguish country-specific terms from pan-regional terms that are also
      genuinely common in the country.
- [ ] Remove duplicates after case, accent, punctuation, and whitespace
      normalization.
- [ ] Exclude invented attributions, weak guesses, and terms whose regional
      meaning cannot be substantiated.
- [ ] Flag vulgar, sensitive, dated, or highly situational usage for reviewer
      attention rather than removing context.

## 3. Entry completeness

Every entry must contain:

- [ ] Stable unique ID.
- [ ] Spanish term or phrase.
- [ ] Concise English meaning.
- [ ] Approved category.
- [ ] Natural Spanish example sentence.
- [ ] Accurate English translation of that sentence.
- [ ] Country identifier matching the module.
- [ ] Usage note when register, audience, geography, or sensitivity matters.

## 4. Automated validation

- [ ] Run a country-lexicon validator that checks required fields and types.
- [ ] Reject unknown categories and country identifiers.
- [ ] Reject duplicate IDs and normalized duplicate terms within the country.
- [ ] Reject empty example sentences and translations.
- [ ] Verify JSON parsing and deterministic output.
- [ ] Run the full Playwright suite on Chromium and WebKit.
- [ ] Confirm country selection, search, audio, and country-aware AI context in
      the lexicon integration tests.

Repository gap as of August 1, 2026: a dedicated validator and review-packet
generator do not yet exist. Build those before preparing Mexico's packet.

## 5. Native-speaker review packet

Export one row per entry with these columns:

`id`, `term`, `meaning_en`, `category`, `example_es`, `example_en`,
`usage_note`, `source`, `review_decision`, `reviewer_correction`,
`reviewer_comment`

Reviewer instructions:

- [ ] Mark each row `approve`, `correct`, `reject`, or `unsure`.
- [ ] Judge whether people in the named country actually use the term with the
      stated meaning today.
- [ ] Correct unnatural wording, register, spelling, and example sentences.
- [ ] Reject technically possible but misleading country attributions.
- [ ] Escalate disputed entries for a second source or second reviewer.

## 6. Review reconciliation

- [ ] Apply all approved corrections to source data, not only generated output.
- [ ] Remove rejected entries; do not replace them solely to preserve counts.
- [ ] Resolve every `unsure` row with stronger evidence or removal.
- [ ] Preserve reviewer name, review date, and packet version outside the public
      app data.
- [ ] Re-run automated validation and integration tests after reconciliation.
- [ ] Produce a final review summary: approved, corrected, rejected, and removed
      counts.

## 7. Module content

For a full course module, not a reference-only lexicon:

- [ ] Sequence reviewed vocabulary into beginner-appropriate units.
- [ ] Add or adapt example sentences using only reviewed regional claims.
- [ ] Add graded stories and comprehension checks.
- [ ] Add study, quiz, browse, audio, and AI-context coverage.
- [ ] Verify that progress IDs are stable before release.
- [ ] Repeat native review for newly authored stories and dialogues.

## 8. Launch gate

All conditions are mandatory:

- [ ] Automated validation passes with zero errors.
- [ ] Chromium and WebKit test suites pass.
- [ ] Native review has no unresolved `unsure` or disputed entries.
- [ ] Corrections are reconciled into the canonical source data.
- [ ] Product copy accurately labels the available depth.
- [ ] Production is exercised with the admin test account.
- [ ] Test data is cleaned up and live counts match the approved packet.
- [ ] Project status, README, and release notes are updated.

## Mexico execution order

1. Build the validator and review-packet generator.
2. Validate the existing Mexico lexicon in `data/country_lexicons.json`.
3. Generate the versioned Mexico review packet with source references.
4. Complete native-speaker review and reconciliation.
5. Decide whether the reviewed content remains a reference lexicon or advances
   into the first post-Guatemala course module.

