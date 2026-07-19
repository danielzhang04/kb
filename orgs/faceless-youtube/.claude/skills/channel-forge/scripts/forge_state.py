"""Resumable, in-order genesis run-state for channel-forge (spec §3)."""
import json
from pathlib import Path

STATE_FILENAME = ".forge-state.json"
_STAGES_JSON = Path(__file__).resolve().parent.parent / "references" / "genesis-stages.json"


def load_default_stages():
    """Return the default genesis stage ids, in walk order."""
    data = json.loads(_STAGES_JSON.read_text(encoding="utf-8"))
    return [s["id"] for s in data]


def _path(channel_dir):
    return Path(channel_dir) / STATE_FILENAME


def _write(channel_dir, state):
    _path(channel_dir).write_text(json.dumps(state, indent=2), encoding="utf-8")
    return state


def init_state(channel_dir, stages):
    """Create the state file at the start of a genesis run."""
    state = {"stages": list(stages), "locked": [], "current": stages[0] if stages else None}
    return _write(channel_dir, state)


def load_state(channel_dir):
    return json.loads(_path(channel_dir).read_text(encoding="utf-8"))


def current_stage(channel_dir):
    return load_state(channel_dir)["current"]


def lock_stage(channel_dir, stage):
    """Lock `stage` (must be the current stage) and advance to the next unlocked stage."""
    state = load_state(channel_dir)
    if stage != state["current"]:
        raise ValueError(f"cannot lock {stage!r}: current stage is {state['current']!r}")
    state["locked"].append(stage)
    remaining = [s for s in state["stages"] if s not in state["locked"]]
    state["current"] = remaining[0] if remaining else None
    return _write(channel_dir, state)


def is_complete(channel_dir):
    return load_state(channel_dir)["current"] is None
