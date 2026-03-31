#!/usr/bin/env python3

from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "item"


def clean(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return value


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_csv_rows(path: Path):
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return [{key: clean(value) for key, value in row.items()} for row in csv.DictReader(handle)]


def enrich_main_words(main_words, phrasebank_rows):
    if len(phrasebank_rows) != len(main_words):
        raise ValueError(
            f"Phrasebank row count mismatch: expected {len(main_words)}, got {len(phrasebank_rows)}"
        )

    rows_by_rank = {}
    for row in phrasebank_rows:
        rank = int(row["Rank"])
        if rank in rows_by_rank:
            raise ValueError(f"Duplicate phrasebank rank {rank}")
        rows_by_rank[rank] = row

    enriched = []
    missing_ranks = []
    mismatches = []

    for entry in main_words:
        rank = int(entry["rank"])
        row = rows_by_rank.get(rank)
        if row is None:
            missing_ranks.append(rank)
            continue
        if clean(entry["spanish"]) != clean(row["Spanish"]):
            mismatches.append((rank, entry["spanish"], row["Spanish"]))
            continue

        enriched.append(
            {
                **entry,
                "miniPhrase": clean(row["Mini Phrase"]),
                "miniPhraseEnglish": clean(row["Phrase English"]),
                "phrasePattern": clean(row["Pattern"]),
            }
        )

    if missing_ranks:
        raise ValueError(f"Missing phrasebank ranks: {missing_ranks[:10]}")
    if mismatches:
        sample = ", ".join(
            f"rank {rank}: {left!r} != {right!r}" for rank, left, right in mismatches[:5]
        )
        raise ValueError(f"Phrasebank Spanish mismatches: {sample}")

    return enriched


def build_fluency_entries(rows, sheet_name, prefix):
    filtered = [row for row in rows if row["Sheet"] == sheet_name]
    entries = []

    for index, row in enumerate(filtered, start=1):
        spanish = clean(row["Spanish"])
        english = clean(row["English"])
        focus = clean(row["Focus"])
        context = clean(row["Use"])
        source = clean(row["Source"])
        tags = [value for value in ["phrase", sheet_name, focus, context] if value]

        entries.append(
            {
                "id": f"{prefix}-{index:03d}-{slugify(spanish)[:24]}",
                "type": "phrase",
                "sheet": sheet_name,
                "sortOrder": index,
                "spanish": spanish,
                "english": english,
                "context": context,
                "focus": focus,
                "source": source,
                "tags": tags,
            }
        )

    return entries


def build_payload(base_payload, fluency_rows, phrasebank_rows, base_path, fluency_path, phrasebank_path):
    base_collections = base_payload["collections"]
    main_words = enrich_main_words(base_collections["mainWords"], phrasebank_rows)
    coffee_phrases = build_fluency_entries(fluency_rows, "Coffee_Shop_Phrases", "phrase")
    conversation_verbs = build_fluency_entries(
        fluency_rows, "Basic_Conversation_Verbs", "conversation"
    )
    guatemala_bonus = base_collections["guatemalaBonus"]

    phrase_total = len(coffee_phrases) + len(conversation_verbs)
    total = len(main_words) + phrase_total + len(guatemala_bonus)
    meta = {
        **base_payload.get("meta", {}),
        "counts": {
            "words": len(main_words),
            "coffeePhrases": len(coffee_phrases),
            "conversationVerbs": len(conversation_verbs),
            "phrases": phrase_total,
            "bonus": len(guatemala_bonus),
            "total": total,
        },
        "sources": {
            "baseDataset": base_path.name,
            "fluencyCsv": fluency_path.name,
            "phrasebankCsv": phrasebank_path.name,
        },
    }

    return {
        "meta": meta,
        "collections": {
            "mainWords": main_words,
            "coffeePhrases": coffee_phrases,
            "conversationVerbs": conversation_verbs,
            "guatemalaBonus": guatemala_bonus,
        },
    }


def main():
    if len(sys.argv) != 5:
        raise SystemExit(
            "Usage: build_study_pack_from_csv_sources.py <base.json> <fluency.csv> <phrasebank.csv> <output.json>"
        )

    base_path = Path(sys.argv[1]).expanduser()
    fluency_path = Path(sys.argv[2]).expanduser()
    phrasebank_path = Path(sys.argv[3]).expanduser()
    output_path = Path(sys.argv[4]).expanduser()

    base_payload = load_json(base_path)
    fluency_rows = load_csv_rows(fluency_path)
    phrasebank_rows = load_csv_rows(phrasebank_path)

    payload = build_payload(
        base_payload,
        fluency_rows,
        phrasebank_rows,
        base_path,
        fluency_path,
        phrasebank_path,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
