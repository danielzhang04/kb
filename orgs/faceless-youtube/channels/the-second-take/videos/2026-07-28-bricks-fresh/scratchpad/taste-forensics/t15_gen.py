"""Task 15 tranche driver - act 1 (L01-L27) through the gated builder path.

PATH. `forge.py gen --batch <spec>` — the GATED builder slate (forge.py:3136 passes
`gate=bool(a.batch)`). That is the correct route for a tranche: every seed is routed by
`cmd_batch`'s own slate decisions, and P3's review gate applies to the whole slate. The
ad-hoc `--seed` exemption task 14 used does NOT apply here and is deliberately not taken.

ONE-ITEM BATCHES, deliberately. The spend law's stall ceiling is 4 minutes PER GEN with one
re-issue (memory: image-gen-stall-policy). A 23-item batch in one process can only carry a
single coarse timeout, so a stall on item 3 would kill the 20 gens behind it. Slicing the
spec into one-item batch files costs ~1s of process startup per gen and buys an exact
per-gen ceiling, an exact re-issue, and a 2-consecutive-503 park rule that continues the
round instead of dropping it.

ROUNDS BY DEPENDENCY (the skill's promote-before-seed law + forge's chain-depth behaviour,
forge.py:1268-1272):
  1  the 7 STEP-1 figure cards        - seed canonical + pose + expression, no scene input
  2  the 23 non-delta scenes          - 7 of them seed a round-1 card, which by then carries
                                        an all-pass digest-current record in the store
  3  the 4 delta scenes               - each seeds its in-chain parent (_staging/<parent>.png),
                                        which by then is verified and promoted
A round is generated in full BEFORE its review runs (SKILL.md: "within a batch, generate
everything first - do not gate mid-batch").
"""
import io
import json
import os
import subprocess
import sys
import time

WT = r"C:\Users\danie\kb-worktrees\boss-taste-forensics"
ORG = os.path.join(WT, "orgs", "faceless-youtube")
KIT_REL = "channels/the-second-take/visual-kit"
FORGE = os.path.join(ORG, ".claude", "skills", "image-generation", "scripts", "forge.py")
STAGING = os.path.join(ORG, KIT_REL.replace("/", os.sep), "_staging")
HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = os.path.join(HERE, "t15-act1.spec.json")

CEILING = 240          # 4-minute stall ceiling per gen
RATE = 0.039           # $/gen, the rate task 12 and 14 both logged
HARD_STOP = 2.75       # cumulative session budget guard for THIS task

DELTAS = ["L12", "L17", "L21", "L25"]


def load_spec():
    return json.load(io.open(SPEC, encoding="utf-8"))


def round_items(n, spec):
    figs = [it for it in spec if it["name"].startswith("fig-")]
    scenes = [it for it in spec if not it["name"].startswith("fig-")]
    if n == 1:
        return figs
    if n == 2:
        return [it for it in scenes if it["name"] not in DELTAS]
    if n == 3:
        return [it for it in scenes if it["name"] in DELTAS]
    raise SystemExit("round must be 1|2|3")


def gen_one(item, dry):
    """One gen, its own process, its own ceiling. Returns (status, seconds)."""
    name = item["name"]
    one = os.path.join(HERE, "_t15_one.json")
    with io.open(one, "w", encoding="utf-8") as f:
        json.dump([item], f)
    cmd = [sys.executable, FORGE, "gen", "--kit", KIT_REL, "--batch", one]
    if dry:
        cmd.append("--dry-run")
    t0 = time.time()
    try:
        r = subprocess.run(cmd, cwd=ORG, capture_output=True, text=True, timeout=CEILING)
    except subprocess.TimeoutExpired:
        return "STALL", time.time() - t0
    el = time.time() - t0
    out = (r.stdout or "") + (r.stderr or "")
    for ln in out.splitlines():
        if "] " + name + ":" in ln or "awaits review" in ln:
            print("   " + ln.strip())
    if r.returncode != 0:
        print((r.stderr or "")[-500:])
        return "FAIL", el
    if "OK -> _staging/" in out:
        return "OK", el
    if "skip (seed awaits review)" in out:
        return "HELD", el
    if "skip (exists in staging)" in out:
        return "EXISTS", el
    if "503" in out or "UNAVAILABLE" in out:
        return "503", el
    if "ERR" in out:
        return "ERR", el
    return "?", el


def main():
    dry = "--live" not in sys.argv
    rnd = int([a for a in sys.argv[1:] if a.isdigit()][0])
    only = [a for a in sys.argv[1:] if a.startswith("L") or a.startswith("fig-")]
    spec = load_spec()
    items = round_items(rnd, spec)
    if only:
        items = [it for it in items if it["name"] in only]
    print(f"=== ROUND {rnd} — {'DRY' if dry else 'LIVE'} — {len(items)} item(s) ===")
    if not dry:
        cost = len(items) * RATE
        print(f"    projected this round: ${cost:.3f} at ${RATE}/gen")

    results, consecutive_503 = {}, 0
    for i, it in enumerate(items, 1):
        name = it["name"]
        print(f"\n--- [{i}/{len(items)}] {name} ---")
        st, el = gen_one(it, dry)
        # ONE re-issue on a stall, per the spend law.
        if st == "STALL":
            print(f"   !! stalled past {CEILING}s — ONE re-issue")
            st, el2 = gen_one(it, dry)
            el += el2
            if st == "STALL":
                st = "PARK-STALL"
        if st == "503":
            consecutive_503 += 1
            if consecutive_503 >= 2:
                print("   !! 2 consecutive 503s — PARKING this frame, continuing the round")
                st = "PARK-503"
        else:
            consecutive_503 = 0
        results[name] = st
        print(f"   -> {st} ({el:.0f}s)")

    print("\n=== summary ===")
    for k, v in results.items():
        print(f"  {k}: {v}")
    ok = sum(1 for v in results.values() if v == "OK")
    print(f"\n  OK={ok}  other={len(results) - ok}")
    if not dry:
        print(f"  spend this round: ${ok * RATE:.3f}")
    with io.open(os.path.join(HERE, f"t15-round{rnd}-results.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, indent=1)


if __name__ == "__main__":
    main()
