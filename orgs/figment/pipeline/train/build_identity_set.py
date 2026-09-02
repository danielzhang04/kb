"""Build a balanced 40-image identity-set manifest from a winning bake-off arm."""

from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import math
import re
import sys
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
POD_RUNNER = HERE.parent / "pod" / "runpod_run.py"

ANGLES = {
    "front": "facing the camera squarely",
    "left-three-quarter": "turned about forty-five degrees to show her left three-quarter view",
    "right-three-quarter": "turned about forty-five degrees to show her right three-quarter view",
    "left-profile": "in a clean left profile with one ear visible",
    "right-profile": "in a clean right profile with one ear visible",
}
LIGHTING = {
    "window-daylight": "soft window daylight in a real bedroom",
    "overcast-window": "diffuse overcast window light in a real bedroom",
    "evening-lamp": "one shaded evening lamp giving low warm ambient light in a real bedroom",
    "night-single-lamp": "one warm bedside lamp at night with natural shadow falloff",
}
DISTANCES = {
    "close-up": "a close-up phone-camera portrait of her face and shoulders",
    "half-body": "a candid half-body phone-camera portrait",
}
WARDROBE = (
    "a fully opaque fitted black camisole with a modest neckline",
    "a fully opaque fitted cream knit top",
    "a fitted dark-green long-sleeve top with full coverage",
    "a fully opaque burgundy square-neck top with a modest neckline",
    "a fitted charcoal crew-neck T-shirt",
    "a fully opaque dark satin slip dress with a modest neckline",
    "a fitted navy ribbed top with full coverage",
    "a fully opaque rust-brown camisole with a modest neckline",
)


class IdentitySetError(ValueError):
    pass


def _load_harness():
    spec = importlib.util.spec_from_file_location("figment_identity_harness", POD_RUNNER)
    if spec is None or spec.loader is None:
        raise IdentitySetError(f"cannot load harness: {POD_RUNNER}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_document(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8-sig")
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        value = _load_harness().parse_simple_yaml(text)
    if not isinstance(value, dict):
        raise IdentitySetError(f"expected object in {path}")
    return value


def prompt_substitution_index(job: dict[str, Any]) -> int:
    matches = [
        index for index, sub in enumerate(job.get("substitutions", []))
        if sub.get("field") == "text" and isinstance(sub.get("value"), str)
    ]
    if len(matches) != 1:
        raise IdentitySetError("candidate base job must contain exactly one text substitution")
    return matches[0]


def candidate_look(manifest: dict[str, Any], candidate: str) -> tuple[str, dict[str, Any]]:
    pattern = re.compile(rf"^trial-03-{re.escape(candidate)}-s1-seed-")
    matches = [job for job in manifest.get("jobs", []) if pattern.match(str(job.get("output_name", "")))]
    if not matches:
        raise IdentitySetError(f"candidate {candidate!r} has no S1 job in arm manifest")
    base = copy.deepcopy(matches[0])
    prompt = base["substitutions"][prompt_substitution_index(base)]["value"]
    try:
        look = prompt.split(" with ", 1)[1].split(", seated on the edge", 1)[0]
    except IndexError as exc:
        raise IdentitySetError("cannot extract candidate look from S1 prompt") from exc
    if not look:
        raise IdentitySetError("extracted candidate look is empty")
    return look, base


def load_lever_settings(path: Path) -> dict[str, Any]:
    """Accept structured JSON/YAML or a filled Markdown skeleton.

    Structured form supports `replacements` and `prompt_clauses`. For Markdown, each
    non-placeholder paragraph immediately below a `### Setting of record` heading is
    appended as a prompt clause.
    """
    text = path.read_text(encoding="utf-8-sig")
    try:
        value = json.loads(text)
        if not isinstance(value, dict):
            raise IdentitySetError("structured lever settings must be an object")
        return value
    except json.JSONDecodeError:
        clauses: list[str] = []
        chunks = re.split(r"^### Setting of record\s*$", text, flags=re.MULTILINE)[1:]
        for chunk in chunks:
            paragraph = chunk.strip().split("\n\n", 1)[0].strip()
            paragraph = re.sub(r"^[-*]\s*", "", paragraph)
            if paragraph and "pending" not in paragraph.lower():
                clauses.append(" ".join(paragraph.splitlines()))
        return {"replacements": {}, "prompt_clauses": clauses}


def apply_settings(text: str, settings: dict[str, Any]) -> str:
    result = text
    replacements = settings.get("replacements", {})
    if not isinstance(replacements, dict):
        raise IdentitySetError("lever settings replacements must be an object")
    for old, new in replacements.items():
        if str(old) not in result:
            raise IdentitySetError(f"lever replacement target is absent: {old!r}")
        result = result.replace(str(old), str(new))
    return result


def make_prompt(
    look: str, angle_text: str, light_text: str, distance_text: str,
    wardrobe: str, clauses: list[str],
) -> str:
    clause_text = " ".join(clause.rstrip(".") + "." for clause in clauses if clause.strip())
    return (
        f"{distance_text.capitalize()} of an unambiguously adult woman around twenty-one with {look}, "
        f"{angle_text}, wearing {wardrobe} and delicate gold jewelry. {light_text.capitalize()} shapes "
        "her naturally textured skin; both hands are naturally rendered if they are in frame. "
        "This is a candid handheld phone snapshot with visible pores, slight film grain, and no studio flash. "
        f"{clause_text} Asian-American woman."
    ).replace("  ", " ")


def build_identity_manifest(
    arm_path: Path, candidate: str, settings_path: Path, trigger: str, caption_dir: Path
) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{2,63}", trigger):
        raise IdentitySetError("trigger must be 3-64 safe token characters and start with a letter")
    manifest = load_document(arm_path)
    settings = load_lever_settings(settings_path)
    look, base_job = candidate_look(manifest, candidate)
    look = apply_settings(look, settings)
    clauses = settings.get("prompt_clauses", [])
    if not isinstance(clauses, list) or any(not isinstance(item, str) for item in clauses):
        raise IdentitySetError("prompt_clauses must be a list of strings")
    caption_dir.mkdir(parents=True, exist_ok=True)
    jobs: list[dict[str, Any]] = []
    index = 0
    for angle_name, angle_text in ANGLES.items():
        for light_name, light_text in LIGHTING.items():
            for distance_name, distance_text in DISTANCES.items():
                wardrobe = WARDROBE[index % len(WARDROBE)]
                name = f"identity__{candidate}__{angle_name}__{light_name}__{distance_name}"
                prompt = make_prompt(look, angle_text, light_text, distance_text, wardrobe, clauses)
                job = copy.deepcopy(base_job)
                job["seed"] = 410001 + index * 1009
                job["output_name"] = name
                job["expected_images"] = 1
                sub_index = prompt_substitution_index(job)
                job["substitutions"][sub_index]["value"] = prompt
                for substitution in job.get("substitutions", []):
                    if substitution.get("field") == "width":
                        substitution["value"] = 1024
                    elif substitution.get("field") == "height":
                        substitution["value"] = 1280
                caption = (
                    f"{trigger}, {angle_name.replace('-', ' ')} angle, {light_name.replace('-', ' ')} "
                    f"lighting, {distance_name.replace('-', ' ')} distance, wearing {wardrobe}"
                )
                sidecar = caption_dir / f"{name}.txt"
                sidecar.write_text(caption + "\n", encoding="utf-8")
                job["caption_sidecar"] = str(sidecar)
                job["identity_cell"] = {
                    "angle": angle_name,
                    "lighting": light_name,
                    "distance": distance_name,
                    "wardrobe": wardrobe,
                }
                jobs.append(job)
                index += 1
    manifest = copy.deepcopy(manifest)
    manifest["jobs"] = jobs
    manifest["readiness_timeout_seconds"] = 480
    manifest["max_minutes"] = math.ceil(8 + len(jobs) * 70 / 60)
    manifest["price_usd_per_hour"] = min(float(manifest["price_usd_per_hour"]), 0.80)
    manifest["identity_set"] = {
        "candidate": candidate,
        "trigger": trigger,
        "angles": list(ANGLES),
        "lighting": list(LIGHTING),
        "distances": list(DISTANCES),
        "lever_settings": str(settings_path),
    }
    _load_harness().require_manifest(manifest, arm_path)
    return manifest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arm", type=Path, required=True)
    parser.add_argument("--candidate", choices=[f"c{i:02d}" for i in range(1, 7)], required=True)
    parser.add_argument("--lever-table", type=Path, required=True)
    parser.add_argument("--trigger", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--caption-dir", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    captions = args.caption_dir or args.out.parent / f"{args.out.stem}-captions"
    try:
        manifest = build_identity_manifest(
            args.arm, args.candidate, args.lever_table, args.trigger, captions
        )
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"built {len(manifest['jobs'])} identity cells; captions={captions}")
        return 0
    except (IdentitySetError, OSError, ValueError) as exc:
        print(f"identity-set error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
