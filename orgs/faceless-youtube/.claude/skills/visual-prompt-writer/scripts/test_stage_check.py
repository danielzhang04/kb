"""Plain-assert test for lint_shots.stage_check — the delta-chain structural caps (HARD).
Run: py -3 .claude/skills/visual-prompt-writer/scripts/test_stage_check.py

The ≤2-delta cap, ONE-base-first rule, and material-change floor are the mechanical shadow of
the progressive-reveal contract. Zero chains is valid; shared scenery never creates a quota."""
import lint_shots


def caps(shots):
    hard, soft = [], []
    lint_shots.stage_check("t", shots, hard, soft)
    return hard, soft


def _base(sid, stage):
    return {"id": sid, "stage": stage, "stage_role": "base"}


def _delta(sid, stage):
    return {"id": sid, "stage": stage, "stage_role": "delta", "changed_elements": ["+ x"]}


# Check 4 — MORE than 2 consecutive deltas after a base is HARD.
over = [_base("L01", "g")] + [_delta(f"L0{i}", "g") for i in range(2, 5)]  # base + 3 deltas
hard, _ = caps(over)
assert any(">2" in h and "delta" in h for h in hard), "should flag the >2-delta chain: %r" % hard

# The cap is exactly 2 — base + 2 deltas passes clean.
ok2 = [_base("L01", "g")] + [_delta(f"L0{i}", "g") for i in range(2, 4)]  # base + 2 deltas
hard, _ = caps(ok2)
assert hard == [], "base + 2 deltas is at the cap, not over it: %r" % hard

# Check 5 — an orphan delta (a stage run with no preceding base) is HARD.
orphan = [_delta("L07", "g")]
hard, _ = caps(orphan)
assert any("L07" in h or ("g" in h and "base" in h) for h in hard), "orphan delta should flag: %r" % hard

# A delta preceded by its base in the same stage is fine.
paired = [_base("L01", "g"), _delta("L02", "g")]
hard, _ = caps(paired)
assert hard == [], "base+delta is clean: %r" % hard

# A second base inside one stage run (not one-base-first) is HARD.
two_base = [_base("L01", "g"), _delta("L02", "g"), _base("L03", "g")]
hard, _ = caps(two_base)
assert any("base" in h for h in hard), "a non-first base should flag: %r" % hard

# The delta count RESETS on a new stage: two separate 2-delta chains are both clean.
two_chains = ([_base("A1", "a")] + [_delta(f"A{i}", "a") for i in range(2, 4)]
              + [_base("B1", "b")] + [_delta(f"B{i}", "b") for i in range(2, 4)])
hard, _ = caps(two_chains)
assert hard == [], "delta count resets per stage: %r" % hard

# Shots with no stage (standalone hard cuts) never trip the caps.
none = [{"id": "L01"}, {"id": "L02"}, {"id": "L03"}, {"id": "L04"}, {"id": "L05"}]
hard, _ = caps(none)
assert hard == [], "no-stage standalone shots are clean: %r" % hard

long_none = [{"id": f"L{i:02d}"} for i in range(1, 41)]
hard, _ = caps(long_none)
assert hard == [], "zero chains is valid at every plan length: %r" % hard

def feasible(change):
    hard = []
    lint_shots.delta_feasibility_check("t", [("L02", {
        "id": "L02", "stage_role": "delta", "changed_elements": change,
        "still_prompt": "held room; only this changes; everything else exactly as established",
    })], hard)
    return hard

assert feasible([]), "an empty change must fail"
assert feasible(["+ tiny decorative tab"]), "a minor detail must fail"
assert feasible(["~ empty executive chair moves to the side"]), "local reposition must fail"
assert feasible(["+ revenue tower rises across the hall"]) == [], "a structural reveal is material"

print("PASS test_stage_check")
