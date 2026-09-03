"""persona.py — creator persona contract: the machine source of truth for a figment
persona (docs/superpowers/specs/2026-09-03-figment-creator-001-design.md §2.2).

`persona.yaml` is the ONLY file a runner reads for identity, register and cell-grammar
data; `identity-spec.md` and `look-spec-v2.md` stay the human rationale, referenced by
path + sha256 so drift between the two is detectable rather than silent.

Written as JSON-compatible YAML — this repo's existing convention (see e.g.
`orgs/figment/pipeline/train/runs/creator-001-composite-02.yaml`, whose ".yaml" content
is literal JSON). Loading reuses the pod harness's existing dependency-free document
loader (`runpod_run.parse_simple_yaml`, tried after a fast-path `json.loads`, exactly
`runpod_run.load_manifest`'s own strategy) rather than adding a second permissive YAML
parser to the repo.

Fail-closed by construction: `validate_persona` raises `ValueError` on anything that
does not match this contract exactly — an unknown top-level key, a duplicate identity
reference, an allocation arithmetic mismatch, an angle/distance/light token outside the
supported vocabulary, or a relative path that escapes the persona directory. A missing
asset file only fails when `require_assets=True` (the production default); a caller may
disable it for a pure schema test, never in production.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Document loading — reuse the pod harness's existing loader, never a second one.
# ---------------------------------------------------------------------------

_POD_MODULE_NAME = "_figment_pipeline_pod_runpod_run"
_GATES_MODULE_NAME = "_figment_pipeline_persona_gates"


def _load_pod_runpod_run():
    """Load pod/runpod_run.py by file path.

    No `__init__.py` exists anywhere under `orgs/figment/pipeline/` — every module in
    this tree is loaded ad hoc by path (see e.g.
    `orgs/figment/pipeline/train/tests/test_training_tools.py`'s `load_module`), so a
    plain `from pod.runpod_run import ...` package import is not available here either.
    """
    if _POD_MODULE_NAME in sys.modules:
        return sys.modules[_POD_MODULE_NAME]
    path = Path(__file__).resolve().parent / "pod" / "runpod_run.py"
    spec = importlib.util.spec_from_file_location(_POD_MODULE_NAME, path)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise ImportError(f"could not load pod/runpod_run.py from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[_POD_MODULE_NAME] = module
    spec.loader.exec_module(module)
    return module


def _load_gates():
    """Load gates.py by file path (same ad-hoc-loading convention as
    `_load_pod_runpod_run` — reuses `gates.sha256_file` rather than reimplementing a
    second streaming-sha256 helper)."""
    if _GATES_MODULE_NAME in sys.modules:
        return sys.modules[_GATES_MODULE_NAME]
    path = Path(__file__).resolve().parent / "gates.py"
    spec = importlib.util.spec_from_file_location(_GATES_MODULE_NAME, path)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise ImportError(f"could not load gates.py from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[_GATES_MODULE_NAME] = module
    spec.loader.exec_module(module)
    return module


def load_document(path: Path) -> Any:
    """Parse `path` as JSON, falling back to the harness's simple-YAML subset.

    Exactly `runpod_run.load_manifest`'s own two-step strategy — reused, not
    reimplemented.
    """
    text = Path(path).read_text(encoding="utf-8")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return _load_pod_runpod_run().parse_simple_yaml(text)


class PersonaError(ValueError):
    """A persona.yaml document violates the persona contract."""


# ---------------------------------------------------------------------------
# Contract vocabulary
# ---------------------------------------------------------------------------

TOP_LEVEL_KEYS = (
    "id",
    "disclosure",
    "identity",
    "body_target",
    "grammar",
    "register",
    "lora",
    "voice",
    "accounts",
    "tiers",
)

# The cell-grammar vocabulary is fixed (design §2.2's "partial closure #8"): a builder
# downstream (P2's build_expansion_set.py) enumerates strata from these exact tokens,
# so an unsupported token here would silently desync the allocation contract.
ALLOWED_ANGLES = frozenset(
    {"front", "three-quarter-l", "three-quarter-r", "profile-l", "near-back"}
)
ALLOWED_DISTANCES = frozenset({"close", "half"})
ALLOWED_LIGHTS = frozenset(
    {"flat-white", "window-day", "lamp-night", "on-camera-flash"}
)
REQUIRED_TRAVERSAL_ORDER = ["angle", "distance", "light"]

ALLOWED_REPLICATE_SCOPES = frozenset({"half-body-strata-only"})
ALLOWED_REPLICATE_POLICIES = frozenset({"alt-wardrobe-new-seed"})
ALLOWED_SEED_POLICIES = frozenset({"fixed-per-cell"})

FLOOR_KEYS = ("status", "value", "calibration_set_sha", "locked_by_gate")
ALLOWED_FLOOR_STATUSES = frozenset({"uncalibrated", "calibrated"})


def _fail(message: str) -> None:
    raise PersonaError(message)


def _require_matching_sha256(resolved: Path, declared: str, field: str) -> None:
    """Fail closed unless `declared` equals `resolved`'s live sha256 digest (design
    §2.2 / module docstring: drift between a spec doc and its persona-recorded hash
    must be detectable, not silent). Only called when the file is known to exist —
    the caller's own missing-file check runs first and takes precedence."""
    actual = _load_gates().sha256_file(resolved)
    if actual != declared:
        _fail(
            f"persona.{field} does not match the live file digest for {resolved}: "
            f"declared {declared!r}, actual {actual!r} — the spec file has drifted "
            f"from the persona document that references it"
        )


def _require_dict(value: Any, field: str) -> dict:
    if not isinstance(value, dict):
        _fail(f"persona.{field} must be an object, got {type(value).__name__}")
    return value


def _require_list(value: Any, field: str) -> list:
    if not isinstance(value, list):
        _fail(f"persona.{field} must be a list, got {type(value).__name__}")
    return value


def _require_nonempty_str(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        _fail(f"persona.{field} must be a non-empty string, got {value!r}")
    return value


def _resolve_reference(
    base_dir: Path, rel: Any, field: str, *, must_stay_within: bool
) -> Path:
    if not isinstance(rel, str) or not rel.strip():
        _fail(f"persona.{field} must be a non-empty relative path string, got {rel!r}")
    resolved = (base_dir / rel).resolve()
    if must_stay_within:
        try:
            resolved.relative_to(base_dir.resolve())
        except ValueError:
            _fail(
                f"persona.{field} = {rel!r} escapes the persona directory "
                f"{base_dir} (resolved to {resolved})"
            )
    return resolved


def _validate_floor_entry(entry: Any, field: str) -> None:
    d = _require_dict(entry, field)
    missing = [key for key in FLOOR_KEYS if key not in d]
    if missing:
        _fail(f"persona.{field} is missing required key(s): {missing}")
    if d["status"] not in ALLOWED_FLOOR_STATUSES:
        _fail(
            f"persona.{field}.status must be one of {sorted(ALLOWED_FLOOR_STATUSES)}, "
            f"got {d['status']!r}"
        )
    if d["status"] == "uncalibrated" and (
        d["calibration_set_sha"] is not None or d["locked_by_gate"] is not None
    ):
        _fail(
            f"persona.{field} is uncalibrated but carries a calibration_set_sha or "
            f"locked_by_gate — an uncalibrated floor must not claim a lock"
        )


def _validate_tokens(values: Any, allowed: frozenset, field: str) -> list[str]:
    items = _require_list(values, field)
    if not items:
        _fail(f"persona.{field} must not be empty")
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, str):
            _fail(f"persona.{field} entries must be strings, got {item!r}")
        if item not in allowed:
            _fail(
                f"persona.{field} contains an unsupported token {item!r} "
                f"(allowed: {sorted(allowed)})"
            )
        if item in seen:
            _fail(f"persona.{field} contains a duplicate token {item!r}")
        seen.add(item)
    return items


def validate_persona(
    data: dict, *, base_dir: Path, require_assets: bool = True
) -> None:
    """Raise `PersonaError` unless `data` fully satisfies the persona contract.

    `base_dir` is the persona's own directory (the directory `persona.yaml` lives
    in) — every relative path in the document resolves against it. `require_assets`
    gates only filesystem existence checks; every structural/schema check (unknown
    keys, duplicate references, allocation arithmetic, token vocabulary, path escape)
    runs unconditionally, `require_assets=False` or not.
    """
    base_dir = Path(base_dir)
    if not isinstance(data, dict):
        _fail(f"persona document must be an object, got {type(data).__name__}")

    unknown = sorted(set(data) - set(TOP_LEVEL_KEYS))
    if unknown:
        _fail(f"persona document has unknown top-level key(s): {unknown}")
    missing_top = [key for key in TOP_LEVEL_KEYS if key not in data]
    if missing_top:
        _fail(f"persona document is missing required top-level key(s): {missing_top}")

    _require_nonempty_str(data["id"], "id")

    disclosure = _require_dict(data["disclosure"], "disclosure")
    if not isinstance(disclosure.get("is_ai_generated"), bool):
        _fail("persona.disclosure.is_ai_generated must be a boolean")

    identity = _require_dict(data["identity"], "identity")
    references = _require_list(identity.get("references"), "identity.references")
    if not references:
        _fail("persona.identity.references must not be empty")
    seen_stems: set[str] = set()
    for rel in references:
        resolved = _resolve_reference(
            base_dir, rel, "identity.references[]", must_stay_within=True
        )
        stem = Path(rel).stem
        if stem in seen_stems:
            _fail(f"persona.identity.references contains a duplicate reference: {stem!r}")
        seen_stems.add(stem)
        if require_assets and not resolved.is_file():
            _fail(f"persona.identity.references[] points at a missing file: {resolved}")

    spec = _require_dict(identity.get("spec"), "identity.spec")
    spec_path = spec.get("path")
    resolved_spec = _resolve_reference(
        base_dir, spec_path, "identity.spec.path", must_stay_within=True
    )
    spec_sha256 = _require_nonempty_str(spec.get("sha256"), "identity.spec.sha256")
    if require_assets:
        if not resolved_spec.is_file():
            _fail(f"persona.identity.spec.path points at a missing file: {resolved_spec}")
        _require_matching_sha256(resolved_spec, spec_sha256, "identity.spec.sha256")

    floor = _require_dict(identity.get("floor"), "identity.floor")
    for key in ("anchor_cosine_p5", "min_face_px"):
        if key not in floor:
            _fail(f"persona.identity.floor is missing required key: {key!r}")
        _validate_floor_entry(floor[key], f"identity.floor.{key}")

    body_target = _require_dict(data["body_target"], "body_target")
    _require_nonempty_str(body_target.get("source"), "body_target.source")
    _require_list(body_target.get("exemplars"), "body_target.exemplars")

    grammar = _require_dict(data["grammar"], "grammar")
    angles = _validate_tokens(grammar.get("angles"), ALLOWED_ANGLES, "grammar.angles")
    distances = _validate_tokens(
        grammar.get("distances"), ALLOWED_DISTANCES, "grammar.distances"
    )
    lights = _validate_tokens(grammar.get("lights"), ALLOWED_LIGHTS, "grammar.lights")
    wardrobe_families = _require_list(
        grammar.get("wardrobe_families"), "grammar.wardrobe_families"
    )
    if not wardrobe_families or len(set(wardrobe_families)) != len(wardrobe_families):
        _fail("persona.grammar.wardrobe_families must be a non-empty list with no duplicates")

    traversal_order = grammar.get("traversal_order")
    if traversal_order != REQUIRED_TRAVERSAL_ORDER:
        _fail(
            f"persona.grammar.traversal_order must be exactly "
            f"{REQUIRED_TRAVERSAL_ORDER} (the builder's fixed enumeration order), "
            f"got {traversal_order!r}"
        )

    allocation = _require_dict(grammar.get("allocation"), "grammar.allocation")
    expected_strata = len(angles) * len(distances) * len(lights)
    if allocation.get("strata") != expected_strata:
        _fail(
            f"persona.grammar.allocation.strata must equal "
            f"len(angles)*len(distances)*len(lights) = {expected_strata}, "
            f"got {allocation.get('strata')!r}"
        )
    if "half" not in distances:
        _fail("persona.grammar.distances must include 'half' — replicates are half-body-only")
    expected_replicates = len(angles) * len(lights)
    if allocation.get("replicates") != expected_replicates:
        _fail(
            f"persona.grammar.allocation.replicates must equal the half-body stratum "
            f"count len(angles)*len(lights) = {expected_replicates}, "
            f"got {allocation.get('replicates')!r}"
        )
    if allocation.get("replicate_scope") not in ALLOWED_REPLICATE_SCOPES:
        _fail(
            f"persona.grammar.allocation.replicate_scope must be one of "
            f"{sorted(ALLOWED_REPLICATE_SCOPES)}, got {allocation.get('replicate_scope')!r}"
        )
    if allocation.get("replicate_policy") not in ALLOWED_REPLICATE_POLICIES:
        _fail(
            f"persona.grammar.allocation.replicate_policy must be one of "
            f"{sorted(ALLOWED_REPLICATE_POLICIES)}, got {allocation.get('replicate_policy')!r}"
        )
    if allocation.get("seed_policy") not in ALLOWED_SEED_POLICIES:
        _fail(
            f"persona.grammar.allocation.seed_policy must be one of "
            f"{sorted(ALLOWED_SEED_POLICIES)}, got {allocation.get('seed_policy')!r}"
        )

    register = _require_dict(data["register"], "register")
    register_spec = _require_dict(register.get("spec"), "register.spec")
    resolved_register_spec = _resolve_reference(
        base_dir, register_spec.get("path"), "register.spec.path", must_stay_within=False
    )
    register_spec_sha256 = _require_nonempty_str(register_spec.get("sha256"), "register.spec.sha256")
    _require_nonempty_str(register_spec.get("section"), "register.spec.section")
    if require_assets:
        if not resolved_register_spec.is_file():
            _fail(f"persona.register.spec.path points at a missing file: {resolved_register_spec}")
        _require_matching_sha256(resolved_register_spec, register_spec_sha256, "register.spec.sha256")
    settings = _require_dict(register.get("settings"), "register.settings")
    _require_nonempty_str(settings.get("makeup"), "register.settings.makeup")
    _require_nonempty_str(settings.get("skin"), "register.settings.skin")
    _validate_tokens(settings.get("light"), ALLOWED_LIGHTS, "register.settings.light")
    if settings.get("wardrobe_families") != wardrobe_families:
        _fail(
            "persona.register.settings.wardrobe_families must match "
            "persona.grammar.wardrobe_families exactly"
        )

    lora = _require_dict(data["lora"], "lora")
    _require_nonempty_str(lora.get("base"), "lora.base")
    _require_nonempty_str(lora.get("tier"), "lora.tier")

    _require_dict(data["voice"], "voice")

    accounts = _require_list(data["accounts"], "accounts")
    for index, account in enumerate(accounts):
        acct = _require_dict(account, f"accounts[{index}]")
        _require_nonempty_str(acct.get("platform"), f"accounts[{index}].platform")
        _require_nonempty_str(acct.get("tier"), f"accounts[{index}].tier")

    tiers = _require_dict(data["tiers"], "tiers")
    for key in ("instagram", "explicit"):
        if key not in tiers:
            _fail(f"persona.tiers is missing required key: {key!r}")
        _require_dict(tiers[key], f"tiers.{key}")


def load_persona(path: Path, *, require_assets: bool = True) -> dict:
    """Load and validate a `persona.yaml` document. Fail-closed by default."""
    path = Path(path)
    data = load_document(path)
    validate_persona(data, base_dir=path.parent, require_assets=require_assets)
    return data
