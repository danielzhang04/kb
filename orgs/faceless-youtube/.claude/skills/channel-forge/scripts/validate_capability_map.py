"""Validate a channel's capability-map.json (channel-forge spec §4)."""
import json
import sys
from pathlib import Path

VALID_RESOLUTIONS = {"reuse", "reconfigure", "adapt", "build", "n/a"}
_SKILL_REQUIRED = {"reuse", "reconfigure", "adapt"}


def validate(data):
    """Return a list of human-readable error strings; empty list means valid."""
    errors = []
    for key in ("channel", "production_pipeline", "slots"):
        if key not in data:
            errors.append(f"missing top-level key: {key}")
    slots = data.get("slots")
    if not isinstance(slots, dict):
        errors.append("'slots' must be an object")
        return errors
    for name, slot in slots.items():
        if not isinstance(slot, dict):
            errors.append(f"slot '{name}' must be an object")
            continue
        res = slot.get("resolution")
        if res not in VALID_RESOLUTIONS:
            errors.append(f"slot '{name}': invalid resolution {res!r}")
            continue
        if res in _SKILL_REQUIRED and not slot.get("skill"):
            errors.append(f"slot '{name}': resolution '{res}' requires 'skill'")
        if res == "build" and not slot.get("plan"):
            errors.append(f"slot '{name}': resolution 'build' requires 'plan'")
    return errors


def validate_file(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return validate(data)


if __name__ == "__main__":
    errs = validate_file(sys.argv[1])
    if errs:
        print("\n".join(errs))
        sys.exit(1)
    print("ok")
