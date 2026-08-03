"""Apply Daniel's 2026-08-03 Tranche-A parked rulings.

This script updates only the named Tranche-A records in assets/_review/merged.json.
The project's stamp_review.py remains the sole writer of manifest review_status fields.
"""
from __future__ import annotations

import json
from pathlib import Path


VIDEO = Path(__file__).resolve().parents[1]
MERGED = VIDEO / "assets" / "_review" / "merged.json"


def clean(why: str) -> dict:
    return {
        "r": "clean",
        "f": "clean",
        "s": "clean",
        "worst": "clean",
        "why": why,
        "dsg": [],
    }


ACCEPTED = {
    "L67": clean(
        "Daniel accept 2026-08-03 (oversized foreground crowd accepted by ruling.)"
    ),
    "L68": clean(
        "Daniel accept 2026-08-03 (oversized crowd and missed shut-door delta accepted by ruling.)"
    ),
    "L205": clean(
        "Daniel accept 2026-08-03 (canonical assets/scenes/L205.png accepted as shown on the review board.)"
    ),
}


PARKED_OBSERVATIONS = {
    "L28": (
        "Daniel 2026-08-03 added observation: Terry Johnson is NAMED CAST, not a crowd rig; "
        "his crowd-tier dot eyes are the defect; repair = named-cast eye-rig retry."
    ),
    "L60": "Daniel 2026-08-03 added observation: additional defect — the crowd is entirely bald.",
    "L108": (
        "Daniel 2026-08-03 added observation: rig very off AND too many people; crowd count must come down."
    ),
    "L109": (
        "Daniel 2026-08-03 added observation: rig very off AND too many people; crowd count must come down."
    ),
    "L161": (
        "Daniel 2026-08-03 added observation: very different from the approved L160 place and base rig; "
        "crowd all bald/cream (hair variation missing)."
    ),
    "L162": (
        "Daniel 2026-08-03 added observation: very different from the approved L160 place and base rig; "
        "crowd all bald/cream (hair variation missing)."
    ),
    "L184": (
        "Daniel 2026-08-03 added observation: completely wrong; full regen (courtroom, Wiles ghost, "
        "anchored to L183)."
    ),
}


def main() -> None:
    data = json.loads(MERGED.read_text(encoding="utf-8"))
    by_id = {item.get("id") or item.get("shot_id"): item for item in data}

    for shot_id, ruling in ACCEPTED.items():
        item = by_id.get(shot_id)
        if item is None:
            raise KeyError(f"missing merged review record: {shot_id}")
        item.update(ruling)

    for shot_id, observation in PARKED_OBSERVATIONS.items():
        item = by_id.get(shot_id)
        if item is None:
            raise KeyError(f"missing merged review record: {shot_id}")
        why = str(item.get("why") or "").rstrip()
        if observation not in why:
            item["why"] = f"{why} {observation}".strip()

    MERGED.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"updated {len(ACCEPTED) + len(PARKED_OBSERVATIONS)} Daniel 2026-08-03 rulings; "
        f"accepted={len(ACCEPTED)} parked-observations={len(PARKED_OBSERVATIONS)}; "
        f"total records: {len(data)}"
    )


if __name__ == "__main__":
    main()
