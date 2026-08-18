#!/usr/bin/env python3
"""Strict A-AND-B merge of the w2-r2 duel verdicts (mirrors w2-slice/merge shape)."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "verdicts" / "merged.json"


def load_axis_fails(path, arm, verifier):
    data = json.loads(path.read_text(encoding="utf-8"))
    out = {}
    for card in data["cards"]:
        fails = [f"{verifier}:{axis}" for axis, val in card["axes"].items() if val == "fail"]
        notes = card.get("notes") or card.get("reason") or ""
        out[card["card"]] = (fails, notes)
    return out


def main():
    sources = {
        ("pro", "A"): HERE / "verdicts" / "pro-A.json",
        ("pro", "B"): HERE / "verdicts" / "pro-B.json",
        ("flash", "A"): HERE / "verdicts" / "flash-A.json",
        ("flash", "B"): HERE / "verdicts" / "flash-B.json",
    }
    per_arm = {}
    for (arm, verifier), path in sources.items():
        per_arm[(arm, verifier)] = load_axis_fails(path, arm, verifier)

    cards_out = []
    strict = {}
    for arm in ("pro", "flash"):
        a = per_arm[(arm, "A")]
        b = per_arm[(arm, "B")]
        names = sorted(set(a) | set(b))
        if len(names) != 10:
            raise ValueError(f"Expected 10 cards for {arm}, got {len(names)}")
        verified = 0
        verified_excl_groundline = 0
        for name in names:
            a_fails, a_notes = a[name]
            b_fails, b_notes = b[name]
            fail_axes = a_fails + b_fails
            status = "VERIFIED" if not fail_axes else "PARKED"
            if status == "VERIFIED":
                verified += 1
            # excluding-ground-line: a card counts toward the excl-groundline
            # tally if it is VERIFIED outright, OR its only fail axis is the
            # systemic B:framing (missing ground line) defect.
            if status == "VERIFIED" or fail_axes == ["B:framing"]:
                verified_excl_groundline += 1
            notes = []
            if a_notes:
                notes.append(f"A: {a_notes}")
            if b_notes:
                notes.append(f"B: {b_notes}")
            cards_out.append({
                "arm": arm,
                "card": name,
                "status": status,
                "fail_axes": fail_axes,
                "notes": notes,
            })
        strict[arm] = {
            "verified": verified,
            "of": 10,
            "verified_excl_groundline": verified_excl_groundline,
        }

    merged = {
        "schema": "w2r2-merged-verdicts@1",
        "strict": strict,
        "cards": cards_out,
    }
    OUT.write_text(json.dumps(merged, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
    print(json.dumps(strict, indent=1))


if __name__ == "__main__":
    main()
