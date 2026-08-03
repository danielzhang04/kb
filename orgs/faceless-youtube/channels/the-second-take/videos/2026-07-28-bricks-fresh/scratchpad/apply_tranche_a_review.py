"""Merge the fresh-eyes Tranche-A rulings into the canonical review record.

This script updates only the named Tranche-A shot rulings.  The project's
stamp_review.py remains the sole writer of manifest review_status fields.
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


def parked(*, why: str, r: str = "clean", f: str = "clean", s: str = "clean") -> dict:
    severities = [value for value in (r, f, s) if value != "clean"]
    rank = {"low": 1, "med": 2, "high": 3, "blocking": 4}
    worst = max(severities, key=lambda value: rank.get(value, 0))
    return {"r": r, "f": f, "s": s, "worst": worst, "why": why, "dsg": []}


RULINGS = {
    "L27": clean(
        "Tranche-A composite accepted: character, conveyor, drive, mountain, and plant "
        "continuity hold. Known non-blocking drift: the lower factory floor shifts from pale "
        "green to warm tan."
    ),
    "L28": parked(
        r="low",
        why="Corrected composite preserves L27 and now shows the drive-shaped lapel badge, "
        "Terry holding one drive with one hand, his other hand open and empty, and four "
        "additional drives. Residual rig defect: Terry's delighted eyes render as crowd-tier "
        "solid dots rather than the named-cast closed curved eyes.",
    ),
    "L49": clean(
        "Human-selected candidate B with known accepted compromises: the chef crowd is "
        "foreground-large, MENU/BILL text is visible, and the dish is off-centre."
    ),
    "L50": clean(
        "Tranche-A composite passes: the split-room renovation reads immediately while the "
        "camera, crowd, dish, boom mic, bills, tables, and left-side decay stay continuous."
    ),
    "L60": parked(
        r="low",
        f="low",
        why="Composite preserves the selected boardroom plate and fixes the invented "
        "stethoscope, but qt-wiles loses his gold tie clip and stands along the table's side, "
        "mostly outside the lamp cone, rather than squarely at the head inside it.",
    ),
    "L61": clean(
        "Fresh-eyes PASS: near-exact L60 continuity with a clear concentric target as the only "
        "material addition. Minor non-blocking variance: the target is brighter and slightly "
        "right of Wiles."
    ),
    "L62": clean(
        "Fresh-eyes PASS: Wiles and the foreman retain identity, costume, pose, and expression; "
        "the envelope and exposed banknotes read clearly in the correct boardroom tableau."
    ),
    "L66": clean(
        "Human-selected candidate B with known accepted compromises: several managers remain "
        "foreground-large and Wiles' feet/floor contact are hidden."
    ),
    "L67": parked(
        r="high",
        f="high",
        why="The open-door exit beat and two box carriers are present, but two enormous standing "
        "foreground crowd figures dominate; the authored small crowd-scale departing workers "
        "and seated remaining crowd are not achieved.",
    ),
    "L68": parked(
        r="med",
        f="high",
        why="Wiles' identity and crossed-arm pose hold, but the defining delta fails: the door "
        "remains wide open instead of shut. Wiles is small in the doorway and oversized "
        "foreground crowd figures remain standing.",
    ),
    "L78": clean(
        "Channel-style v3 accepted: a cast-free physical warehouse insert with exactly one "
        "drive mapped to one isolated ledger tally. The tally's diagonal lean is non-blocking."
    ),
    "L91": clean(
        "Tranche-A standalone PASS: brick-foreman retains canonical identity and costume, the "
        "shrug pose uses two four-digit hands, and the repaired prose-versus-seed composition holds."
    ),
    "L100": clean(
        "Human-selected candidate B with known accepted compromise: the giant manager head wall "
        "remains the dominant read."
    ),
    "L101": clean(
        "Fresh-eyes PASS: locked L100 continuation with the same nine crowd figures, table, "
        "paper, coffee, pens, and lighting, adding exactly one red brick and no text."
    ),
    "L107": clean("Human-selected candidate B; three open brick cartons and crowd rig pass."),
    "L108": parked(
        r="high",
        f="high",
        s="low",
        why="The three bricks disappear, workers become large detailed figures rather than the "
        "crowd rig, and invented legible text 'ACME 458-B' replaces the required plain mark.",
    ),
    "L109": parked(
        r="high",
        f="high",
        s="low",
        why="Continuity breaks with a new crowd wall and changed carton arrangement; zero bricks "
        "and only three primary boxes appear instead of three brick cartons plus one genuine "
        "drive box. Invented 'ACME 458-B' text and crowd-rig violations persist.",
    ),
    "L160": clean("Human-selected candidate A; crowd rig, lantern, cabinets, doorway, and exact 1989 hold."),
    "L161": parked(
        f="high",
        s="high",
        why="The exact 1989, vacant chair, and lantern-light payload are present, but the camera, "
        "crowd count and placement, doorway, cabinets, lantern, and calendar are re-authored "
        "rather than preserving L160's locked frame.",
    ),
    "L162": parked(
        f="high",
        why="Continuity with staged L161 is strong and exact 1989 holds, but the authored action "
        "delta is not achieved: the lantern is not visibly raised and only the light pool shifts.",
    ),
    "L183": clean("Human-selected candidate B; banker identity, fear expression, and recoil pose pass."),
    "L184": parked(
        r="high",
        f="high",
        s="high",
        why="Major continuity and identity failure: L183's courtroom, framing, pose, and scale are "
        "replaced by a high-rise office, and the ghost is a generic bald or hooded figure rather "
        "than qt-wiles.",
    ),
    "L190": clean(
        "Corrected picked-A composition passes with three separate money stacks and exact "
        "lettering '128 MILLION'."
    ),
    "L191": clean(
        "Fresh-eyes PASS: strong L190 continuity, three distinct-height money stacks, exact 128 "
        "MILLION text, banker offering, auditor holding a blank page, and crowd-tier executives."
    ),
    "L215": clean(
        "Tranche-A standalone PASS: open drive carton, moulded foam recess, coarse red clay brick, "
        "and cold grey-green industrial setting are present; the selected brighter brick reads as "
        "the intended closing accent."
    ),
}


def main() -> None:
    data = json.loads(MERGED.read_text(encoding="utf-8"))
    by_id = {item.get("id") or item.get("shot_id"): item for item in data}
    for shot_id, ruling in RULINGS.items():
        item = by_id.get(shot_id)
        if item is None:
            item = {"id": shot_id}
            data.append(item)
            by_id[shot_id] = item
        item.update(ruling)
    MERGED.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"updated {len(RULINGS)} Tranche-A rulings; total records: {len(data)}")


if __name__ == "__main__":
    main()
