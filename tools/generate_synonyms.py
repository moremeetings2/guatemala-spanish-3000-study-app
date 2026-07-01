#!/usr/bin/env python3
"""
Generate Spanish synonym data for the Main 3000 flashcard deck.

Uses NLTK's Open Multilingual Wordnet (omw-1.4) to look up 2-3 common
Spanish synonyms for each word. Words with no useful synonyms are skipped.

Usage:
    pip3 install nltk
    python3 tools/generate_synonyms.py

Output: data/synonyms.json — a dict mapping Spanish word (lowercase) → list of synonyms
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:
    import nltk
except ImportError:
    sys.exit("Run: pip3 install nltk")

nltk.download("omw-1.4", quiet=True)
nltk.download("wordnet", quiet=True)
from nltk.corpus import wordnet as wn  # noqa: E402  (after download)

ROOT = Path(__file__).resolve().parent.parent
STUDY_PACK = ROOT / "data" / "guatemala_spanish_study_pack.json"
OUT = ROOT / "data" / "synonyms.json"

POS_MAP = {
    "noun": wn.NOUN,
    "verb": wn.VERB,
    "adjective": wn.ADJ,
    "adverb": wn.ADV,
}


def infer_pos(pos_str: str) -> str | None:
    if not pos_str:
        return None
    s = pos_str.lower()
    if "verb" in s:
        return wn.VERB
    if "adjective" in s or "adjetivo" in s:
        return wn.ADJ
    if "adverb" in s or "adverbio" in s:
        return wn.ADV
    if "noun" in s or "sustantivo" in s:
        return wn.NOUN
    return None


def clean_name(name: str) -> str:
    return name.replace("_", " ").strip()


def get_synonyms(word: str, pos: str | None, max_count: int = 3) -> list[str]:
    word_lower = word.lower().strip()

    # Try with POS hint first, then fall back to all synsets
    candidates_pos = wn.synsets(word_lower, pos=pos, lang="spa") if pos else []
    candidates_all = wn.synsets(word_lower, lang="spa")
    synsets = candidates_pos + [s for s in candidates_all if s not in candidates_pos]

    seen: set[str] = {word_lower}
    results: list[str] = []

    for syn in synsets:
        for lemma in syn.lemmas(lang="spa"):
            name = clean_name(lemma.name()).lower()
            if name in seen:
                continue
            # Skip multi-word phrases that are overly long or technical
            if len(name) > 20 or re.search(r"\d", name):
                continue
            # Skip entries that look like WordNet typos (doubled vowels unusual in Spanish)
            if re.search(r"(?<![aeiouáéíóú])[aeiou]{3}", name) or re.search(r"ee|ii|oo|uu", name):
                continue
            # Skip if it's clearly just an inflected form of the same root
            # (simple heuristic: shares first 4 chars and length is similar)
            if (
                len(word_lower) >= 4
                and len(name) >= 4
                and word_lower[:4] == name[:4]
                and abs(len(word_lower) - len(name)) <= 2
            ):
                continue
            seen.add(name)
            results.append(name)
            if len(results) >= max_count:
                break
        if len(results) >= max_count:
            break

    return results


def main() -> None:
    print(f"Loading study pack from {STUDY_PACK}...")
    pack = json.loads(STUDY_PACK.read_text(encoding="utf-8"))
    main_words = pack["collections"]["mainWords"]
    print(f"  {len(main_words)} words to process")

    synonyms: dict[str, list[str]] = {}
    hit = 0
    miss = 0

    for entry in main_words:
        word = (entry.get("spanish") or "").strip()
        if not word or len(word) > 40:
            miss += 1
            continue

        pos = infer_pos(entry.get("partOfSpeech") or "")
        syns = get_synonyms(word, pos)

        if syns:
            synonyms[word] = syns
            hit += 1
        else:
            miss += 1

    print(f"  Found synonyms for {hit} words, {miss} had none")

    OUT.write_text(json.dumps(synonyms, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
