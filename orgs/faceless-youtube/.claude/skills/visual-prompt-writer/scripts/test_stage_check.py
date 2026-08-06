"""Plain-assert test for lint_shots.stage_check — the delta-chain structural caps (HARD).
Run: py -3 .claude/skills/visual-prompt-writer/scripts/test_stage_check.py

The ≤2-delta cap and the ONE-base-first rule are the mechanical shadow of the shots-schema
delta-chain contract (base + ≤2 deltas, then re-base or hard-cut). These caps were prose-only
until made HARD in stage_check; this file pins them so they can't silently regress."""
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

# Strict v2 long-form plans at the configured size need a planned stage chain, but no quota.
long_none = [{"id": f"L{i:02d}"} for i in range(1, 41)]
hard, _ = [], []
lint_shots.stage_check("long-form", long_none, hard, _, require_stage=True)
assert any("zero stage-bearing shots/base roles" in h for h in hard), hard

short_none = [{"id": f"L{i:02d}"} for i in range(1, 40)]
hard, _ = [], []
lint_shots.stage_check("long-form", short_none, hard, _, require_stage=False)
assert hard == [], "the zero guard is limited to configured long-form plans: %r" % hard

stage_bearing = [_base("L01", "g")] + [{"id": f"L{i:02d}"} for i in range(2, 41)]
hard, _ = [], []
lint_shots.stage_check("long-form", stage_bearing, hard, _, require_stage=True)
assert hard == [], "one planned stage chain satisfies the zero guard: %r" % hard

print("PASS test_stage_check")
