#!/usr/bin/env python3
"""blind_pool.py — the blind-grading harness (figment W0 trial; trial-protocol.md).

New for figment (no FYT equivalent — FYT never compared arms blindly). Ties qa_stamp.py and
build_grading_board.py together into a full blind trial:

    blind_pool.py build   --arm A=<dir> --arm B=<dir> [...] --pool <dir> --key <file>
        -> pool/ (anonymized images + an arm-free manifest.json for qa_stamp.py)
        -> key.json, written OUTSIDE pool/ (arm + original filename per image_id)

    py -3 build_grading_board.py --manifest <pool>/manifest.json --out board.html --blind
        -> hand the grader ONLY board.html — never the pool directory or key.json. The
           board is self-contained (images inlined) precisely so nothing else needs sharing.

    py -3 qa_stamp.py <rulings.json> <pool>/manifest.json
        -> stamps review_status/parked_reasons onto the pool manifest, in place

    blind_pool.py reveal  --manifest <pool>/manifest.json --key <file> [--out report.json]
        -> de-anonymizes and reports per-arm pass rates + a failure taxonomy

The key file is the one piece of information that would break blindness, so `build` refuses
to write it anywhere under `--pool` (that directory, or a board built from it, is what the
grader sees) and `--out`/`--key` default to a location one level above the pool dir.

Pure stdlib. No network. Copies by default; `--symlink` tries symlinks first (useful for a
large image set) and silently falls back to copying per-file if the OS/filesystem refuses
(e.g. no Developer Mode / admin on Windows).
"""
import argparse
import json
import os
import random
import re
import shutil
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_EXTS = (".png", ".jpg", ".jpeg", ".webp")


# ---------- build ----------

def _parse_arm(spec: str):
    if "=" not in spec:
        raise argparse.ArgumentTypeError(f"--arm expects NAME=DIR, got {spec!r}")
    name, _, path = spec.partition("=")
    name, path = name.strip(), path.strip()
    if not name or not path:
        raise argparse.ArgumentTypeError(f"--arm expects NAME=DIR, got {spec!r}")
    return name, Path(path)


def _collect(arms: dict, exts):
    """[(arm_name, path), ...] — one dir's files sorted for determinism, dirs in the order
    given on the command line. The caller shuffles this before it means anything."""
    items = []
    for name, d in arms.items():
        if not d.is_dir():
            sys.exit(f"--arm {name}: not a directory: {d}")
        files = sorted(p for p in d.iterdir() if p.is_file() and p.suffix.lower() in exts)
        if not files:
            sys.exit(f"--arm {name}: no images with extensions {exts} in {d}")
        items.extend((name, p) for p in files)
    return items


def _guard_key_not_under_pool(key_path: Path, pool_dir: Path):
    """The whole point of --key living outside --pool: a grader given filesystem access to
    the pool directory (not just the rendered board) must never be able to stumble onto the
    de-anonymization key sitting right next to the images."""
    key_r, pool_r = key_path.resolve(), pool_dir.resolve()
    if key_r == pool_r or pool_r in key_r.parents:
        sys.exit(
            f"--key ({key_path}) resolves inside --pool ({pool_dir}) — this would put the "
            f"de-anonymization key somewhere a grader with directory access could read it. "
            f"Point --key somewhere outside the pool directory."
        )


def _place(src: Path, dst: Path, use_symlink: bool, warned: list):
    if use_symlink:
        try:
            os.symlink(src.resolve(), dst)
            return
        except OSError:
            if not warned:
                print("note: symlinking failed (no privilege?) — falling back to copy", file=sys.stderr)
                warned.append(True)
    shutil.copy2(src, dst)


def cmd_build(args):
    arms = dict(args.arm)  # preserves insertion order (py3.7+)
    exts = tuple(e if e.startswith(".") else "." + e for e in args.ext.lower().split(","))
    pool_dir = args.pool
    key_path = args.key

    _guard_key_not_under_pool(key_path, pool_dir)

    items = _collect(arms, exts)
    seed = args.seed if args.seed is not None else random.SystemRandom().randrange(2**31)
    random.Random(seed).shuffle(items)  # destroy any per-arm/positional correlation

    pool_dir.mkdir(parents=True, exist_ok=True)
    width = max(4, len(str(len(items))))
    warned = []
    key_images, manifest_images = [], []

    for n, (arm, src) in enumerate(items, start=1):
        image_id = f"img_{n:0{width}d}"
        anon_name = image_id + src.suffix.lower()
        dst = pool_dir / anon_name
        if dst.exists():
            sys.exit(f"refusing to overwrite existing pool file {dst}")
        _place(src, dst, args.symlink, warned)

        key_images.append(dict(
            image_id=image_id,
            arm=arm,
            original_filename=src.name,
            original_path=str(src.resolve()),
        ))
        # The pool manifest is arm-free by construction — it is the one file that may sit
        # inside the pool directory itself, next to the images a grader will actually see.
        manifest_images.append(dict(
            image_id=image_id,
            path=anon_name,
            review_status="unreviewed",
            parked_reasons=[],
        ))

    key_path.parent.mkdir(parents=True, exist_ok=True)
    key_path.write_text(json.dumps(dict(
        schema="figment/blind-pool-key@1",
        created_utc=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        seed=seed,
        pool_dir=str(pool_dir.resolve()),
        arms={name: str(d.resolve()) for name, d in arms.items()},
        images=key_images,
    ), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    manifest_path = pool_dir / "manifest.json"
    manifest_path.write_text(json.dumps(dict(images=manifest_images), ensure_ascii=False, indent=1) + "\n",
                              encoding="utf-8")

    print(f"pooled {len(items)} image(s) from {len(arms)} arm(s) into {pool_dir}")
    print(f"manifest: {manifest_path}  (arm-free — safe to sit beside the images)")
    print(f"key:      {key_path}  (has arm mapping — never hand this or --pool to the grader)")


# ---------- reveal ----------

# The failure taxonomy across all seven review axes (P1 step 1.5) — the four quality
# axes (qa_stamp.py's parked_reasons, unchanged shape) plus the three mandatory
# safety axes (qa_stamp.py's separate safety_reasons field, design §2.4a). Each axis
# keeps its own enum; never conflate "hard-fail" with "flag" or "fail".
_AXIS_REASON_RE = re.compile(
    r"^(?P<axis>identity|realism|hands|lighting): (?P<state>soft-fail|hard-fail)$"
    r"|^(?P<safety_axis>adult_read|garment_integrity|real_person_resemblance): "
    r"(?P<safety_state>ambiguous|fail|flag)$"
)


def _load_images(path: Path, what: str):
    if not path.exists():
        sys.exit(f"no {what} at {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    images = data.get("images") if isinstance(data, dict) else data
    if not images:
        sys.exit(f"no images found in {what} {path}")
    return images


def cmd_reveal(args):
    manifest_images = _load_images(args.manifest, "manifest")
    key_images = _load_images(args.key, "key")

    arm_of = {}
    for e in key_images:
        iid = e.get("image_id")
        if iid:
            arm_of[iid] = e.get("arm", "?")

    per_arm = defaultdict(lambda: Counter())
    axis_failures = defaultdict(lambda: Counter())
    other_reasons = defaultdict(lambda: Counter())
    unmatched = []

    for e in manifest_images:
        iid = e.get("image_id") or e.get("id")
        if not iid:
            continue
        arm = arm_of.get(iid)
        if arm is None:
            unmatched.append(iid)
            continue
        status = e.get("review_status") or "unreviewed"
        per_arm[arm][status] += 1
        if status == "parked":
            for reason in e.get("parked_reasons") or []:
                m = _AXIS_REASON_RE.match(str(reason))
                if m:
                    axis, state = m.group("axis"), m.group("state")
                    axis_failures[arm][f"{axis}: {state}"] += 1
                else:
                    other_reasons[arm][str(reason)] += 1
        # safety_failed is orthogonal to review_status (design §2.4a: a safety
        # failure never forces review_status to "parked") — so this scans
        # safety_reasons unconditionally, not only when status == "parked".
        for reason in e.get("safety_reasons") or []:
            m = _AXIS_REASON_RE.match(str(reason))
            if m:
                axis, state = m.group("safety_axis"), m.group("safety_state")
                axis_failures[arm][f"{axis}: {state}"] += 1
            else:
                other_reasons[arm][str(reason)] += 1

    if unmatched:
        sys.exit(
            f"{len(unmatched)} manifest image_id(s) have no entry in the key, e.g. "
            f"{unmatched[0]!r} — mismatched manifest/key pair, refusing to report a "
            f"partial (and therefore misleading) reveal."
        )

    report = {}
    lines = []
    for arm in sorted(per_arm):
        c = per_arm[arm]
        verified, parked, unreviewed = c["verified"], c["parked"], c["unreviewed"]
        total = verified + parked + unreviewed
        graded = verified + parked
        pass_rate = verified / graded if graded else None
        report[arm] = dict(
            total=total, verified=verified, parked=parked, unreviewed=unreviewed,
            pass_rate_of_graded=pass_rate,
            axis_failures=dict(axis_failures[arm]),
            other_failure_reasons=dict(other_reasons[arm]),
        )
        lines.append(f"\narm {arm}: {total} image(s), {graded} graded"
                      + (f" ({unreviewed} still unreviewed)" if unreviewed else ""))
        if graded:
            lines.append(f"  pass rate: {verified}/{graded} = {pass_rate:.0%}")
        if axis_failures[arm]:
            lines.append("  failure taxonomy (by axis):")
            for reason, n in axis_failures[arm].most_common():
                lines.append(f"    {n:>3}  {reason}")
        if other_reasons[arm]:
            lines.append("  other parked reasons:")
            for reason, n in other_reasons[arm].most_common():
                lines.append(f"    {n:>3}  {reason}")

    print("\n".join(lines).lstrip("\n") if lines else "no images to report")

    if args.out:
        args.out.write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"\nreport written: {args.out}")


# ---------- cli ----------

def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="blind_pool.py",
        description="Pool multiple arms' images into one anonymized, shuffled directory for "
                     "blind grading, then de-anonymize a graded manifest to score each arm.",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="pool arm directories into an anonymized, shuffled pool")
    b.add_argument("--arm", action="append", required=True, type=_parse_arm, metavar="NAME=DIR",
                    help="repeatable: one source directory per trial arm, e.g. --arm A=out/comfyui --arm B=out/saas")
    b.add_argument("--pool", required=True, type=Path, help="output directory for anonymized images")
    b.add_argument("--key", required=True, type=Path,
                    help="output path for the de-anonymization key (must NOT be under --pool)")
    b.add_argument("--symlink", action="store_true", help="symlink instead of copy (falls back to copy on failure)")
    b.add_argument("--ext", default=",".join(e.lstrip(".") for e in DEFAULT_EXTS),
                    help="comma-separated extensions to pool (default: %(default)s)")
    b.add_argument("--seed", type=int, default=None, help="shuffle seed (default: random each run)")
    b.set_defaults(func=cmd_build)

    r = sub.add_parser("reveal", help="de-anonymize a stamped manifest and report per-arm results")
    r.add_argument("--manifest", required=True, type=Path, help="the pool's manifest.json, after qa_stamp.py has run")
    r.add_argument("--key", required=True, type=Path, help="the key.json written by `build`")
    r.add_argument("--out", type=Path, default=None, help="optional path to write the JSON report")
    r.set_defaults(func=cmd_reveal)

    return ap


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
