# tests/test_context_lifecycle_inert.py
"""The U8 acceptance guard: the context-lifecycle hook family is INERT and carries NO GateGuard.

Two things this unit promised and a reader cannot verify by eye:
  1. ZERO live-settings edits — `.claude/**` is byte-identical to HEAD and has no new untracked file.
     A hook that arms itself is the failure mode this whole family is shaped to avoid.
  2. NO GateGuard — the ECC subsystem that was deliberately dropped (it is off in this repo's own
     settings, `ECC_GATEGUARD: off`). No reclaimed code may drag it back in.
"""
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOKS = REPO / "scripts" / "hooks"

FAMILY = [
    HOOKS / "lib" / "context_store.js",
    HOOKS / "context_lifecycle_session_start.js",
    HOOKS / "context_lifecycle_pre_compact.js",
    HOOKS / "context_lifecycle_activity_tracker.js",
    # U7's re-grounding hook shares this file's guard, its seam is documented in the U8 proposal, and
    # it deserves the same no-GateGuard / declares-itself-inert coverage every other hook here gets —
    # so it belongs in the family even though it predates this unit.
    HOOKS / "regrounding_hook.js",
]


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return result.stdout


def test_no_live_settings_were_touched():
    assert git("diff", "--", ".claude/").strip() == ""
    assert git("diff", "--cached", "--", ".claude/").strip() == ""
    assert git("status", "--porcelain", "--", ".claude/").strip() == ""


def test_no_hook_is_registered_in_any_settings_file():
    for settings in (REPO / ".claude").glob("settings*.json"):
        text = settings.read_text(encoding="utf-8")
        assert "context_lifecycle" not in text, settings
        assert "context_store" not in text, settings
        # Driven off FAMILY (not a hand-picked substring list) so every member — including U7's
        # regrounding_hook.js — trips this guard on arming, the same way the other four do.
        for path in FAMILY:
            assert path.stem not in text, (settings, path.stem)


def test_no_gateguard_reached_scripts_hooks_through_this_unit():
    """GateGuard is the ECC subsystem this reclaim DROPPED — see the decision-note in the proposal.

    Two committed files legitimately name it: they cite `gateguard-fact-force.js` as the PROVENANCE of
    the destructive-command classifier a previous import retargeted. That citation is not GateGuard;
    GateGuard itself is off in this repo (`ECC_GATEGUARD: off`). What must stay true is that no NEW
    file under scripts/hooks/ mentions it — the U8 family least of all.
    """
    allowed = {HOOKS / "hard_ceiling_guard.js", HOOKS / "lib" / "destructive_classifier.js"}
    hits = {
        path
        for path in HOOKS.rglob("*")
        if path.is_file() and "gateguard" in path.read_text(encoding="utf-8", errors="replace").lower()
    }
    assert hits <= allowed
    assert not (hits & set(FAMILY))


def test_every_family_file_declares_itself_inert():
    for path in FAMILY:
        assert "INERT" in path.read_text(encoding="utf-8"), path
