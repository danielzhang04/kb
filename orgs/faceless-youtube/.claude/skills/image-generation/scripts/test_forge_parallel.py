#!/usr/bin/env python3
"""Tests for forge.py's dependency-aware parallel batch scheduler (2026-07-30 SPEED item) plus the
three §4b logic changes that ride alongside it: the base-rig auto-seed, the `no_hands` registry
flag, and the `_rejected/`-then-regen retry path.

Run: py -3 -m pytest test_forge_parallel.py -q

Network-free throughout: `forge.nano` / `to_png_bytes` / `validate_png` are monkeypatched
module-globally to synthesize a tiny valid PNG instead of calling the engine — the same technique
`test_forge_seed_requirement.py::test_success_log_line_prints_the_resolved_size` already uses. A
lightweight `_FakeKit` stands in for the bible-reading `Kit` (same spirit as that file's
`_stub_kit`) so no real visual-kit, `.env`, or network is touched.
"""
import os
import re
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import forge
from forge import (SEED_CAP, base_rig_seed_needed, hands_clause_suppressed, reject_frame,
                   cmd_gen, cmd_reject, _batch_dependencies, _topo_check)

FAKE_PNG = forge.PNG_MAGIC + b"\0" * 2000


class _FakeKit:
    """Minimal stand-in for `Kit`: enough surface for `_gen_single`/`cmd_gen` with no bible or
    registry file on disk. `resolve_seed` checks an absolute path, then `_staging/<basename>`
    (so a chain delta can seed a sibling batch entry's freshly-written output), then `refs/<s>`."""

    def __init__(self, tmp, characters=None):
        self.root = tmp
        self.kit = tmp
        self.staging = os.path.join(tmp, "_staging")
        self.refs = os.path.join(tmp, "refs")
        os.makedirs(self.staging, exist_ok=True)
        os.makedirs(os.path.join(self.refs, "base"), exist_ok=True)
        with open(os.path.join(self.refs, "base", "base.png"), "wb") as f:
            f.write(FAKE_PNG)
        self.reg = {"characters": characters or {}}
        self.url = "https://example.invalid/"   # forge.nano is monkeypatched; never actually hit
        self.ctx = None

    def resolve_seed(self, s):
        s = str(s)
        cands = []
        if os.path.isabs(s):
            cands.append(s)
        cands.append(os.path.join(self.staging, os.path.basename(s)))
        cands.append(os.path.join(self.refs, s))
        for cand in cands:
            if os.path.exists(cand):
                return cand
        raise SystemExit(f"seed frame not found: {s}")

    def base_frame(self, character):
        return os.path.join(self.refs, "base", "base.png")

    def prompt_for(self, mode, delta, hold=False, figures=None, stage_role=None):
        return f"PROMPT mode={mode} hold={hold} figures={figures!r} :: {delta or ''}"


def _install_fake_engine(monkeypatch, fail_names=(), trace=None, delay=0.0):
    """Every gen 'succeeds' with a tiny valid PNG, except names in `fail_names` (a substring match
    against the assembled prompt text — tests embed the gen's own name as the delta's last word so
    the fake engine can tell requests apart without forge passing `name` through `nano()`).
    `trace`, if given, is a (list, Lock) pair appended with each name as its nano() call lands —
    used to observe scheduling/launch order and to prove concurrent overlap."""
    def _fake_nano(url, parts, aspect, ctx, size):
        text = parts[-1]["text"]
        name = text.split()[-1]
        if trace is not None:
            lst, lock = trace
            with lock:
                lst.append(name)
        if delay:
            time.sleep(delay)
        if any(fn == name for fn in fail_names):
            raise RuntimeError(f"synthetic engine failure for {name}")
        return b"stand-in engine bytes"

    monkeypatch.setattr(forge, "nano", _fake_nano)
    monkeypatch.setattr(forge, "to_png_bytes", lambda data: FAKE_PNG)
    monkeypatch.setattr(forge, "validate_png", lambda data: None)


def _req(name, mode="environment", seed=None, figures=None, character=None, **extra):
    r = {"name": name, "mode": mode, "delta": f"a scene for chain node {name}",
        "seed": seed, "figures": figures}
    if character is not None:
        r["character"] = character
    r.update(extra)
    return r


# --------------------------------------------------------------------------------------------- #
# Topological ordering + concurrency: parents always before children
# --------------------------------------------------------------------------------------------- #
def test_topological_order_parents_before_children(monkeypatch, tmp_path):
    trace = ([], threading.Lock())
    _install_fake_engine(monkeypatch, trace=trace, delay=0.01)
    k = _FakeKit(str(tmp_path))
    base = os.path.join(k.refs, "base", "base.png")
    # deliberately OUT of dependency order in the list: C first, A last-but-one, B mid — the
    # scheduler must still launch strictly A -> B -> C (a genuine 3-node chain: C seeds B's not-
    # yet-existing output, B seeds A's).
    reqs = [
        _req("C", seed=["B.png"]),
        _req("A", seed=[base]),
        _req("B", seed=["A.png"]),
    ]
    rc = cmd_gen(k, reqs, force=True, image_size="2K", dry=False, concurrency=3)
    assert rc == 0
    assert trace[0] == ["A", "B", "C"], trace[0]


def test_independent_nodes_run_concurrently_not_serially(monkeypatch, tmp_path):
    """A real speed proof, not just a correctness one: N independent (no-dependency) gens with an
    artificial per-gen delay must take materially less wall-clock at concurrency=4 than at
    concurrency=1 — the entire point of this feature."""
    n = 8
    delay = 0.05
    k = _FakeKit(str(tmp_path))
    base = os.path.join(k.refs, "base", "base.png")
    reqs = [_req(f"S{i}", seed=[base]) for i in range(n)]

    _install_fake_engine(monkeypatch, delay=delay)
    t0 = time.time()
    rc_serial = cmd_gen(k, reqs, force=True, image_size="2K", dry=False, concurrency=1)
    serial_elapsed = time.time() - t0
    assert rc_serial == 0

    k2 = _FakeKit(str(tmp_path) + "-2")
    reqs2 = [_req(f"S{i}", seed=[os.path.join(k2.refs, "base", "base.png")]) for i in range(n)]
    _install_fake_engine(monkeypatch, delay=delay)
    t0 = time.time()
    rc_par = cmd_gen(k2, reqs2, force=True, image_size="2K", dry=False, concurrency=4)
    par_elapsed = time.time() - t0
    assert rc_par == 0

    assert serial_elapsed >= n * delay * 0.9, serial_elapsed
    # 4-way concurrency on 8 independent gens: ~2 batches of delay, generously bounded at 0.6x
    assert par_elapsed < serial_elapsed * 0.6, (serial_elapsed, par_elapsed)


# --------------------------------------------------------------------------------------------- #
# Cycle detection — fail closed BEFORE any spend
# --------------------------------------------------------------------------------------------- #
def test_cycle_fails_closed_before_any_spend(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(forge, "nano", lambda *a, **k: calls.append(1) or b"x")
    k = _FakeKit(str(tmp_path))
    reqs = [
        _req("A", seed=[os.path.join(k.refs, "base", "base.png")], after=["B"]),
        _req("B", seed=[os.path.join(k.refs, "base", "base.png")], after=["A"]),
    ]
    with pytest.raises(SystemExit, match="CYCLE"):
        cmd_gen(k, reqs, force=True, image_size="2K", dry=False, concurrency=2)
    assert calls == [], "a cyclic batch must never reach the engine"


def test_unknown_dependency_fails_closed(tmp_path):
    k = _FakeKit(str(tmp_path))
    reqs = [_req("A", seed=[os.path.join(k.refs, "base", "base.png")], after=["ghost"])]
    with pytest.raises(SystemExit, match="unknown"):
        cmd_gen(k, reqs, force=True, image_size="2K", dry=True, concurrency=1)


# --------------------------------------------------------------------------------------------- #
# Unique-name pre-validation — before any launch
# --------------------------------------------------------------------------------------------- #
def test_duplicate_names_fail_closed_before_any_spend(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(forge, "nano", lambda *a, **k: calls.append(1) or b"x")
    k = _FakeKit(str(tmp_path))
    base = os.path.join(k.refs, "base", "base.png")
    reqs = [_req("dup", seed=[base]), _req("dup", seed=[base])]
    with pytest.raises(SystemExit, match="duplicate"):
        cmd_gen(k, reqs, force=True, image_size="2K", dry=False, concurrency=2)
    assert calls == []


# --------------------------------------------------------------------------------------------- #
# A failed gen skips ONLY its descendants; the rest of the batch completes; nonzero exit
# --------------------------------------------------------------------------------------------- #
def test_failure_skips_only_descendants_rest_of_batch_completes(monkeypatch, tmp_path):
    trace = ([], threading.Lock())
    _install_fake_engine(monkeypatch, fail_names={"P"}, trace=trace)
    k = _FakeKit(str(tmp_path))
    base = os.path.join(k.refs, "base", "base.png")
    reqs = [
        _req("S", seed=[base]),                 # independent sibling -> must still complete
        _req("P", seed=[base]),                 # fails at the engine
        _req("C1", seed=["P.png"]),              # depends on P -> must be skipped, not run
        _req("C2", seed=["C1.png"]),             # depends on C1 -> must also be skipped
    ]
    rc = cmd_gen(k, reqs, force=True, image_size="2K", dry=False, concurrency=4)
    assert rc != 0, "a batch with a failure must exit nonzero"
    assert "S" in trace[0] and "P" in trace[0]
    assert "C1" not in trace[0] and "C2" not in trace[0], \
        "a skipped descendant must never reach the engine"
    assert os.path.exists(os.path.join(k.staging, "S.png"))
    assert not os.path.exists(os.path.join(k.staging, "P.png"))  # failed gen writes nothing
    assert not os.path.exists(os.path.join(k.staging, "C1.png"))
    assert not os.path.exists(os.path.join(k.staging, "C2.png"))


# --------------------------------------------------------------------------------------------- #
# Ledger integrity under concurrency — no dropped/duplicated report lines
# --------------------------------------------------------------------------------------------- #
def test_ledger_integrity_under_concurrency(monkeypatch, capsys, tmp_path):
    n = 25
    _install_fake_engine(monkeypatch)
    k = _FakeKit(str(tmp_path))
    base = os.path.join(k.refs, "base", "base.png")
    reqs = [_req(f"L{i:02d}", seed=[base]) for i in range(n)]
    rc = cmd_gen(k, reqs, force=True, image_size="2K", dry=False, concurrency=8)
    assert rc == 0
    out = capsys.readouterr().out
    nums = sorted(int(m.group(1)) for m in re.finditer(r"\[(\d+)/%d\]" % n, out))
    assert nums == list(range(1, n + 1)), nums   # every slot filled exactly once, none dropped
    assert f"== {n} generated, 0 failed, 0 skipped ==" in out


# --------------------------------------------------------------------------------------------- #
# `_rejected/` move + regen — the retry path
# --------------------------------------------------------------------------------------------- #
def test_reject_frame_moves_to_rejected_with_timestamp_and_is_noop_when_absent(tmp_path):
    staging = str(tmp_path)
    os.makedirs(staging, exist_ok=True)
    assert reject_frame(staging, "nothing-here") is None
    src = os.path.join(staging, "L01.png")
    with open(src, "wb") as f:
        f.write(b"OLD-BYTES")
    dst = reject_frame(staging, "L01")
    assert dst is not None
    assert not os.path.exists(src)
    assert os.path.dirname(dst) == os.path.join(staging, "_rejected")
    assert os.path.basename(dst).startswith("L01--")
    assert open(dst, "rb").read() == b"OLD-BYTES"  # preserved as evidence, byte for byte


def test_reject_first_then_regen_via_cmd_gen(monkeypatch, tmp_path):
    _install_fake_engine(monkeypatch)
    k = _FakeKit(str(tmp_path))
    base = os.path.join(k.refs, "base", "base.png")
    stale = os.path.join(k.staging, "L01.png")
    with open(stale, "wb") as f:
        f.write(b"STALE-REJECTED-CONTENT")
    reqs = [_req("L01", seed=[base], reject_first=True)]
    # force=False on purpose: without reject_first this would silently no-op (skip-if-exists).
    rc = cmd_gen(k, reqs, force=False, image_size="2K", dry=False, concurrency=1)
    assert rc == 0
    fresh = open(os.path.join(k.staging, "L01.png"), "rb").read()
    assert fresh == FAKE_PNG, "regen must have actually run, not silently skipped"
    rej_dir = os.path.join(k.staging, "_rejected")
    moved = os.listdir(rej_dir)
    assert len(moved) == 1 and moved[0].startswith("L01--")
    assert open(os.path.join(rej_dir, moved[0]), "rb").read() == b"STALE-REJECTED-CONTENT"


def test_cmd_reject_cli_reports_noop_and_move(tmp_path, capsys):
    k = _FakeKit(str(tmp_path))
    open(os.path.join(k.staging, "L02.png"), "wb").write(b"x")
    cmd_reject(k, ["L02", "L99-never-staged"])
    out = capsys.readouterr().out
    assert "L02: rejected ->" in out
    assert "L99-never-staged: nothing staged" in out
    assert not os.path.exists(os.path.join(k.staging, "L02.png"))


# --------------------------------------------------------------------------------------------- #
# §4b item 1 — base-rig auto-seed on a declared anon_foreground figure
# --------------------------------------------------------------------------------------------- #
def test_base_rig_seed_needed_fires_only_on_declared_anon_foreground_non_identity():
    fig = {"anon_foreground": ["the clerk at the wicket"]}
    assert base_rig_seed_needed("environment", fig) is True
    assert base_rig_seed_needed("style", fig) is True
    assert base_rig_seed_needed("new_character", fig) is True
    # identity pass: NEVER, even if (as should not happen) `figures` were somehow set
    assert base_rig_seed_needed("identity", fig) is False
    # crowd-only (no anon_foreground) -> no base-rig seed
    assert base_rig_seed_needed("environment", {"crowd": True}) is False
    # nothing declared
    assert base_rig_seed_needed("environment", None) is False
    assert base_rig_seed_needed("environment", {}) is False


def test_base_seed_auto_added_and_visible_in_dry_seed_list(monkeypatch, tmp_path, capsys):
    k = _FakeKit(str(tmp_path))
    env_anchor = os.path.join(k.refs, "env-anchor.png")
    open(env_anchor, "wb").write(FAKE_PNG)
    reqs = [_req("L07", mode="environment", seed=[env_anchor],
                figures={"anon_foreground": ["the worker at the dock edge"]})]
    rc = cmd_gen(k, reqs, force=True, image_size="2K", dry=True, concurrency=1)
    assert rc == 0
    out = capsys.readouterr().out
    seeds_line = [ln for ln in out.splitlines() if "seeds:" in ln][0]
    assert "base/base.png" in seeds_line, seeds_line
    assert "env-anchor.png" in seeds_line, seeds_line


def test_identity_pass_with_figures_none_never_gets_the_base_seed(monkeypatch, tmp_path, capsys):
    k = _FakeKit(str(tmp_path))
    reqs = [_req("L07-genB", mode="identity", figures=None,
                seed=[os.path.join(k.refs, "base", "base.png")])]
    rc = cmd_gen(k, reqs, force=True, image_size="2K", dry=True, concurrency=1)
    assert rc == 0
    out = capsys.readouterr().out
    seeds_line = [ln for ln in out.splitlines() if "seeds:" in ln][0]
    assert seeds_line.count("base.png") == 1, seeds_line  # the one EXPLICIT seed, not doubled


def test_base_seed_warns_and_does_not_exceed_the_cap(monkeypatch, tmp_path, capsys):
    k = _FakeKit(str(tmp_path))
    four_seeds = []
    for i in range(SEED_CAP):
        p = os.path.join(k.refs, f"anchor{i}.png")
        open(p, "wb").write(FAKE_PNG)
        four_seeds.append(p)
    reqs = [_req("L20", mode="environment", seed=four_seeds,
                figures={"anon_foreground": ["the stall keeper"]})]
    rc = cmd_gen(k, reqs, force=True, image_size="2K", dry=True, concurrency=1)
    assert rc == 0
    out = capsys.readouterr().out
    assert "WARNING: L20" in out and "exceed the 4-seed cap" in out
    seeds_line = [ln for ln in out.splitlines() if "seeds:" in ln][0]
    assert "base/base.png" not in seeds_line, seeds_line   # never added once it would exceed
    assert seeds_line.count(".png") == SEED_CAP, seeds_line


def test_seed_cap_still_hard_errors_when_exceeded_explicitly(tmp_path):
    k = _FakeKit(str(tmp_path))
    five = []
    for i in range(SEED_CAP + 1):
        p = os.path.join(k.refs, f"x{i}.png")
        open(p, "wb").write(FAKE_PNG)
        five.append(p)
    reqs = [_req("over", mode="environment", seed=five)]
    with pytest.raises(SystemExit, match="seed cap"):
        cmd_gen(k, reqs, force=True, image_size="2K", dry=True, concurrency=1)


# --------------------------------------------------------------------------------------------- #
# §4b item 2 — `no_hands` registry flag suppresses the §2c hand clause
# --------------------------------------------------------------------------------------------- #
CHARACTERS = {"pc-boxy": {"no_hands": True}, "macgregor": {}}


def test_hands_clause_suppressed_only_when_every_figure_is_flagged():
    char_seed = ["/kit/refs/pc-boxy/pc-boxy.png"]
    assert hands_clause_suppressed("new_character", "pc-boxy", char_seed, None, CHARACTERS) is True
    # an unflagged named character -> clause stays
    assert hands_clause_suppressed(
        "new_character", "macgregor", ["/kit/refs/macgregor/m.png"], None, CHARACTERS) is False
    # mixed: a flagged seed PLUS an unflagged one -> clause stays (ANY unflagged figure present)
    mixed = ["/kit/refs/pc-boxy/pc-boxy.png", "/kit/refs/macgregor/m.png"]
    assert hands_clause_suppressed("environment", None, mixed, None, CHARACTERS) is False
    # a declared anon_foreground figure is never flagged (not a registry entry)
    assert hands_clause_suppressed(
        "environment", None, char_seed, {"anon_foreground": ["a passerby"]}, CHARACTERS) is False
    # crowd declared -> never suppressed
    assert hands_clause_suppressed("environment", None, char_seed, {"crowd": True}, CHARACTERS) is False
    # an ambiguous seed (a chained scene frame) fails closed -> clause stays
    ambiguous = ["/kit/videos/s/assets/scenes/L05.png"]
    assert hands_clause_suppressed("environment", None, ambiguous, None, CHARACTERS) is False
    # no figure source identified at all -> nothing to suppress against
    assert hands_clause_suppressed("environment", None, [], None, CHARACTERS) is False


def test_pc_boxy_dry_gen_shows_hold_false_unflagged_shows_hold_true(monkeypatch, tmp_path, capsys):
    k = _FakeKit(str(tmp_path), characters=CHARACTERS)
    pc_boxy_seed = os.path.join(k.refs, "pc-boxy", "pc-boxy.png")
    os.makedirs(os.path.dirname(pc_boxy_seed), exist_ok=True)
    open(pc_boxy_seed, "wb").write(FAKE_PNG)
    macgregor_seed = os.path.join(k.refs, "macgregor", "macgregor-base.png")
    os.makedirs(os.path.dirname(macgregor_seed), exist_ok=True)
    open(macgregor_seed, "wb").write(FAKE_PNG)

    reqs = [
        _req("L01", mode="new_character", character="pc-boxy", seed=[pc_boxy_seed]),
        _req("L26", mode="new_character", character="macgregor", seed=[macgregor_seed]),
    ]
    rc = cmd_gen(k, reqs, force=True, image_size="2K", dry=True, concurrency=1)
    assert rc == 0
    out = capsys.readouterr().out
    l01_block = out.split("L01:")[1].split("L26:")[0] if "L26:" in out.split("L01:")[1] else out.split("L01:")[1]
    assert "hold=False" in l01_block, l01_block
    l26_block = out.split("L26:")[1]
    assert "hold=True" in l26_block, l26_block


# --------------------------------------------------------------------------------------------- #
# Dependency derivation from `after` and from a seed naming a sibling's output
# --------------------------------------------------------------------------------------------- #
def test_batch_dependencies_derives_from_after_and_from_seed_basename():
    reqs = [
        {"name": "A", "seed": None},
        {"name": "B", "seed": ["A.png"]},                      # auto-derived from the seed
        {"name": "C", "seed": [], "after": ["B"]},              # explicit `after`
        {"name": "D", "seed": ["channels/x/visual-kit/_staging/B.png"]},  # path-shaped, same stem
    ]
    deps = _batch_dependencies(reqs)
    assert deps["A"] == set()
    assert deps["B"] == {"A"}
    assert deps["C"] == {"B"}
    assert deps["D"] == {"B"}


def test_topo_check_passes_on_a_dag_and_raises_on_a_cycle():
    names = ["A", "B", "C"]
    _topo_check(names, {"A": set(), "B": {"A"}, "C": {"B"}})  # no raise
    with pytest.raises(SystemExit, match="CYCLE"):
        _topo_check(names, {"A": {"C"}, "B": {"A"}, "C": {"B"}})


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
