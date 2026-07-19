#!/usr/bin/env python3
"""Score proxy-judge verdicts against Daniel's calibration answer key.

Two agreement metrics per script:
  - verdict_match: did the judge reach the same greenlight/revise/reject as Daniel?
  - same-lines overlap: precision/recall of the flagged quotes (normalized).

Verdict values greenlight/accept are treated as the same "accept" class so a
judge greenlight matches a Daniel accept.

Run: python score_agreement.py <verdicts_dir> <calibration-set.md>
"""
import sys
import re
import pathlib

from lint_calibration import parse_calibration

# Judge emits greenlight/revise/reject; Daniel's calib uses accept/revise/reject.
_ACCEPT = {"accept", "greenlight"}


def _verdict_class(v):
    return "accept" if v in _ACCEPT else v


def norm_quote(q: str) -> str:
    q = re.sub(r"[^\w\s]", "", q.lower())
    return " ".join(q.split()[:8])


def parse_verdict(text: str) -> dict:
    m = re.search(r"```verdict\n(.*?)```", text, re.S)
    body = m.group(1) if m else text
    vm = re.search(r"^verdict:\s*(\w+)", body, re.M)
    quotes = re.findall(r'^\s*-\s*quote:\s*"?(.+?)"?\s*$', body, re.M)
    return {
        "verdict": vm.group(1) if vm else None,
        "flagged": [{"quote": q} for q in quotes],
    }


def score(pred: dict, truth: dict) -> dict:
    pset = {norm_quote(f["quote"]) for f in pred.get("flagged", []) if f.get("quote")}
    tset = {norm_quote(f["quote"]) for f in truth.get("flagged", []) if f.get("quote")}
    hits = len(pset & tset)
    return {
        "verdict_match": _verdict_class(pred.get("verdict")) == _verdict_class(truth.get("verdict")),
        "line_recall": (hits / len(tset)) if tset else 1.0,
        "line_precision": (hits / len(pset)) if pset else 1.0,
    }


def main(verdicts_dir: pathlib.Path, calib_file: pathlib.Path) -> int:
    truth = {e["id"]: e for e in parse_calibration(calib_file.read_text(encoding="utf-8"))}
    n = matches = 0
    recalls = []
    for vf in sorted(verdicts_dir.glob("*.md")):
        cid = vf.stem
        if cid not in truth:
            print(f"skip {vf.name}: no calibration entry with id {cid!r}")
            continue
        r = score(parse_verdict(vf.read_text(encoding="utf-8")), truth[cid])
        n += 1
        matches += int(r["verdict_match"])
        recalls.append(r["line_recall"])
        print(f"{cid}: verdict_match={r['verdict_match']} "
              f"recall={r['line_recall']:.2f} precision={r['line_precision']:.2f}")
    if n:
        mean_recall = sum(recalls) / len(recalls)
        print(f"\nAGGREGATE: verdict-agreement {matches}/{n} "
              f"({matches / n:.0%}); mean line-recall {mean_recall:.2f}")
    else:
        print("no matching verdict/calibration pairs found")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: python score_agreement.py <verdicts_dir> <calibration-set.md>")
        sys.exit(2)
    sys.exit(main(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])))
