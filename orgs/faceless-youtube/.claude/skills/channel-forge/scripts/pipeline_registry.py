"""The production-pipeline registry (channel-forge spec §8).

Lists the BUILT production pipelines the `production-pipeline` genesis stage can select.
A pipeline with status != 'built' is a BUILD target, not selectable until its
brainstorm->plan->build project ships and flips it to 'built'.
"""
import json
from pathlib import Path

_REGISTRY = Path(__file__).resolve().parent.parent / "references" / "pipeline-registry.json"


def load_registry():
    return json.loads(_REGISTRY.read_text(encoding="utf-8"))


def get(pipeline_id):
    for p in load_registry():
        if p["id"] == pipeline_id:
            return p
    return None


def list_built():
    return [p for p in load_registry() if p.get("status") == "built"]


def is_built(pipeline_id):
    p = get(pipeline_id)
    return bool(p) and p.get("status") == "built"


if __name__ == "__main__":
    for p in load_registry():
        mark = "[x]" if p.get("status") == "built" else "[ ]"
        print(f"{mark} {p['id']:24} [{p.get('status')}] {p['description']}")
