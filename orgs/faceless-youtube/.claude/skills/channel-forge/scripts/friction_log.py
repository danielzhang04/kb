"""Friction log for the channel-forge learning loop (spec §7, contract clause G).

The conductor appends a friction note whenever a stage causes rework / gets it wrong before
converging / the human redirects. At run-end the notes are harvested, abstracted, confirmed
with the human, and routed into the durable layer. Lives at the channel ROOT (survives
.workspace pruning).
"""
import json
from pathlib import Path

FRICTION_FILENAME = ".forge-friction.jsonl"


def _path(channel_dir):
    return Path(channel_dir) / FRICTION_FILENAME


def log_friction(channel_dir, stage, note):
    """Append one friction entry ({stage, note}) as a JSONL line."""
    entry = {"stage": stage, "note": note}
    with open(_path(channel_dir), "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    return entry


def read_friction(channel_dir):
    """Return all friction entries for this genesis run (empty list if none)."""
    p = _path(channel_dir)
    if not p.exists():
        return []
    return [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]
