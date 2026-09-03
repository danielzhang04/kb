"""Tests for `expand/build_variation_set.py` (X3-B: docs/superpowers/specs/
2026-09-03-figment-expansion-03-design.md §2/§3/§4,
REVIEW-2026-09-03-expansion-03-design.md fixes 1-2).

Reuses the repo's existing ad-hoc file loader (no `__init__.py` package import is
assumed for `pod`/`train`/`persona.py`/`expand`), the same pattern
`test_build_expansion_set.py` already uses — including reusing that test module's
own `BANNED_PHRASES` mirror of look-spec-v2.md §4a rather than a second copy.
"""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

import pytest

EXPAND = Path(__file__).resolve().parents[1]
PIPELINE = EXPAND.parent
POD = PIPELINE / "pod"
TRAIN = PIPELINE / "train"
PERSONAS = PIPELINE.parent / "personas"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


bvs = load_module("figment_expand_build_variation_set", EXPAND / "build_variation_set.py")
bes_test = load_module(
    "figment_expand_test_build_expansion_set_for_variation", EXPAND / "tests" / "test_build_expansion_set.py"
)
pod = load_module("figment_expand_variation_test_pod_runpod_run", POD / "runpod_run.py")
persona_mod = load_module("figment_expand_variation_test_persona", PIPELINE / "persona.py")

PERSONA = PERSONAS / "creator-001" / "persona.yaml"
BASE_MANIFEST = TRAIN / "runs" / "creator-001-composite-02.yaml"
MULTIREF_WORKFLOW = TRAIN / "workflows" / "klein4b_multiref_api.json"
VARIATION_WORKFLOW = EXPAND / "workflows" / "klein4b_anchor_variation_api.json"
TEMPLATES = EXPAND / "templates" / "anchor-variations.yaml"

BANNED_PHRASES = bes_test.BANNED_PHRASES
UNSAFE_TERMS = bes_test.UNSAFE_TERMS

ANCHORS = ("g01", "g02", "g07")
TEMPLATE_IDS = tuple(f"T{i:02d}" for i in range(1, 13))
PILOT_KEYS = {("g01", "T06"), ("g02", "T11"), ("g07", "T12")}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def persona():
    return persona_mod.load_persona(PERSONA)


@pytest.fixture(scope="module")
def templates_doc():
    return bvs.load_templates(TEMPLATES)


@pytest.fixture
def allocation(persona, templates_doc):
    return bvs.generate_variation_allocation(persona, templates_doc)


def all_prompts_b(persona, templates_doc, allocation):
    return [bvs.build_prompt_b(templates_doc, cell) for cell in allocation]


def all_prompts_a(persona, templates_doc, allocation):
    return [bvs.build_prompt_a(templates_doc, cell) for cell in allocation]


# ---------------------------------------------------------------------------
# Templates — count, word limits, register words, banned terms
# ---------------------------------------------------------------------------


def test_templates_file_has_exactly_12_templates_t01_through_t12(templates_doc):
    ids = [t["template_id"] for t in templates_doc["templates"]]
    assert ids == list(TEMPLATE_IDS)


def test_pilot_cells_declared_in_templates_file_match_the_review_fix(templates_doc):
    declared = {(row["anchor"], row["template_id"]) for row in templates_doc["pilot_cells"]}
    assert declared == PILOT_KEYS


def test_register_clause_is_fixed_and_carries_the_four_locked_tokens(templates_doc):
    clause = templates_doc["identity_register_clause"].lower()
    for token in ("winged black liner", "defined lashes", "glossy pink-nude lips", "jet-black hair"):
        assert token in clause


def test_b_prompts_are_at_most_40_words_and_carry_the_fixed_register_clause(
    persona, templates_doc, allocation
):
    register = templates_doc["identity_register_clause"]
    for cell in allocation:
        prompt = bvs.build_prompt_b(templates_doc, cell)
        assert prompt.startswith(register)
        assert len(prompt.split()) <= 40


def test_a_prompts_are_at_most_25_words_in_edit_grammar(persona, templates_doc, allocation):
    for cell in allocation:
        prompt = bvs.build_prompt_a(templates_doc, cell)
        assert len(prompt.split()) <= 25
        assert prompt.startswith("The same woman as the reference, identical face;")


def test_t11_uses_the_shorter_capture_clause_every_other_template_the_default(
    persona, templates_doc, allocation
):
    for cell in allocation:
        prompt = bvs.build_prompt_b(templates_doc, cell)
        if cell["template_id"] == "T11":
            assert prompt.endswith(templates_doc["capture_clause_t11"])
        else:
            assert prompt.endswith(templates_doc["capture_clause_default"])


def _whole_word_hits(text: str, terms: frozenset) -> list[str]:
    """Word-boundary matches only — a naive substring scan false-flags the fixed
    register clause's approved "pink-nude" (a lip-colour term, not the sexual
    UNSAFE_TERMS "nude") if it isn't excluded, and false-flags "fifteen" against
    the banned age-family "teen" (a spelling artifact, not the word "teen")."""
    lowered = text.lower()
    return [term for term in terms if re.search(rf"\b{re.escape(term)}\b", lowered)]


def test_variation_and_edit_action_text_is_clean_of_look_spec_banned_terms(
    persona, templates_doc, allocation
):
    """Scans everything this builder authors fresh — the B-prompt's variation
    clause (register clause stripped off, since that fixed clause was already
    litigated byte-for-byte in design §2a and ships unmodified in
    `composite-02.yaml` today) and the whole A-prompt (which never carries the
    register clause at all)."""
    register = templates_doc["identity_register_clause"]
    for cell in allocation:
        b_prompt = bvs.build_prompt_b(templates_doc, cell)
        assert b_prompt.startswith(register)
        b_rest = b_prompt[len(register):]
        assert _whole_word_hits(b_rest, BANNED_PHRASES | UNSAFE_TERMS) == []

        a_prompt = bvs.build_prompt_a(templates_doc, cell)
        assert _whole_word_hits(a_prompt, BANNED_PHRASES | UNSAFE_TERMS) == []


def test_wardrobe_t12_clauses_are_distinct_per_anchor(templates_doc):
    t12 = next(t for t in templates_doc["templates"] if t["template_id"] == "T12")
    values = set(t12["variation_clause"].values())
    assert len(values) == 3
    action_values = set(t12["edit_action"].values())
    assert len(action_values) == 3


# ---------------------------------------------------------------------------
# Allocation — 36 cells, deterministic, seed formula
# ---------------------------------------------------------------------------


def test_allocation_is_deterministic_36_cells_unique_ids_and_seeds(persona, templates_doc):
    one = bvs.generate_variation_allocation(persona, templates_doc)
    two = bvs.generate_variation_allocation(persona, templates_doc)
    assert one == two
    assert len(one) == 36
    assert len({c["cell_id"] for c in one}) == len({c["seed"] for c in one}) == 36


def test_allocation_covers_every_anchor_template_pair_exactly_once(allocation):
    pairs = {(c["anchor"], c["template_id"]) for c in allocation}
    assert pairs == {(a, t) for a in ANCHORS for t in TEMPLATE_IDS}


def test_seed_formula_matches_design_530000_plus_1000_times_anchor_idx_plus_template_idx(allocation):
    for cell in allocation:
        anchor_idx = ANCHORS.index(cell["anchor"])
        template_idx = TEMPLATE_IDS.index(cell["template_id"]) + 1
        assert cell["seed"] == 530000 + 1000 * anchor_idx + template_idx


def test_cell_denoise_matches_the_templates_files_own_denoise_rung(allocation, templates_doc):
    by_id = {t["template_id"]: t["denoise"] for t in templates_doc["templates"]}
    for cell in allocation:
        assert cell["denoise"] == by_id[cell["template_id"]]


def test_cell_id_and_output_name_carry_the_anchor_field(allocation):
    for cell in allocation:
        assert cell["cell_id"] == f"exp03-{cell['anchor']}-t{TEMPLATE_IDS.index(cell['template_id']) + 1:02d}"
        assert cell["anchor"] in ANCHORS


def test_exactly_3_pilot_cells_matching_the_review_fixs_one_per_anchor_assignment(allocation):
    pilot = bvs.pilot_cells(allocation)
    assert {(c["anchor"], c["template_id"]) for c in pilot} == PILOT_KEYS
    assert len(pilot) == 3


def test_full_cells_are_the_33_non_pilot_cells(allocation):
    full = bvs.full_cells(allocation)
    pilot = bvs.pilot_cells(allocation)
    assert len(full) == 33
    assert len(full) + len(pilot) == 36
    assert not (set(c["cell_id"] for c in full) & set(c["cell_id"] for c in pilot))


# ---------------------------------------------------------------------------
# Reference substitutions — target anchor first
# ---------------------------------------------------------------------------


def test_reference_substitutions_put_the_target_anchor_first_in_nodes_6_7_8(persona):
    for anchor in ANCHORS:
        subs = bvs._reference_substitutions(persona, anchor)
        assert [s["node_id"] for s in subs] == ["6", "7", "8"]
        assert subs[0]["value"] == f"creator-001/{anchor}.jpg"
        others = {s["value"] for s in subs[1:]}
        assert others == {f"creator-001/{a}.jpg" for a in ANCHORS if a != anchor}


# ---------------------------------------------------------------------------
# Pilot manifests — pairing, node targets, harness contract
# ---------------------------------------------------------------------------


@pytest.fixture
def pilot_manifest_paths(tmp_path):
    return bvs.build_pilot_manifests(
        PERSONA, BASE_MANIFEST, MULTIREF_WORKFLOW, VARIATION_WORKFLOW, TEMPLATES, tmp_path,
    )


def test_pilot_emits_two_manifests_one_workflow_each_per_pod_readme(pilot_manifest_paths):
    assert set(pilot_manifest_paths) == {"A", "B"}
    for path in pilot_manifest_paths.values():
        manifest = pod.load_manifest(path)
        assert isinstance(manifest["workflow"], dict)
        assert len(manifest["jobs"]) == 3


def test_pilot_pairs_the_same_anchor_and_variation_across_both_arms(pilot_manifest_paths):
    manifest_a = pod.load_manifest(pilot_manifest_paths["A"])
    manifest_b = pod.load_manifest(pilot_manifest_paths["B"])

    def anchor_of(job):
        image_sub = next(s for s in job["substitutions"] if s["node_id"] == "6")
        return Path(image_sub["value"]).stem

    seeds_a = {job["seed"]: anchor_of(job) for job in manifest_a["jobs"]}
    seeds_b = {job["seed"]: anchor_of(job) for job in manifest_b["jobs"]}
    assert seeds_a == seeds_b
    assert set(seeds_a.values()) == set(ANCHORS)
    # Output names distinguish the arm but share the same underlying cell_id.
    names_a = {job["output_name"] for job in manifest_a["jobs"]}
    names_b = {job["output_name"] for job in manifest_b["jobs"]}
    assert names_a == {f"{name}-mechA" for name in names_b}


def test_pilot_a_jobs_carry_no_denoise_substitution_b_jobs_do(pilot_manifest_paths):
    manifest_a = pod.load_manifest(pilot_manifest_paths["A"])
    manifest_b = pod.load_manifest(pilot_manifest_paths["B"])
    for job in manifest_a["jobs"]:
        assert not any(s["node_id"] == "29" for s in job["substitutions"])
    for job in manifest_b["jobs"]:
        denoise_subs = [s for s in job["substitutions"] if s["node_id"] == "29"]
        assert len(denoise_subs) == 1
        assert denoise_subs[0]["field"] == "denoise"


def test_a_manifest_substitutions_target_real_nodes_in_the_multiref_graph(pilot_manifest_paths):
    manifest = pod.load_manifest(pilot_manifest_paths["A"])
    workflow_node_ids = set(manifest["workflow"])
    assert "29" not in workflow_node_ids  # unmodified multiref graph has no SplitSigmasDenoise
    for job in manifest["jobs"]:
        for sub in job["substitutions"]:
            assert sub["node_id"] in workflow_node_ids


def test_b_manifest_substitutions_target_real_nodes_in_the_variation_graph(pilot_manifest_paths):
    manifest = pod.load_manifest(pilot_manifest_paths["B"])
    workflow_node_ids = set(manifest["workflow"])
    assert "29" in workflow_node_ids
    for job in manifest["jobs"]:
        for sub in job["substitutions"]:
            assert sub["node_id"] in workflow_node_ids


def test_pilot_manifest_keys_are_within_pod_readmes_documented_schema(pilot_manifest_paths):
    bes = bvs._bes()
    for path in pilot_manifest_paths.values():
        manifest = pod.load_manifest(path)
        assert set(manifest) <= bes.ALLOWED_MANIFEST_KEYS
        forbidden = {"network_volume_id", "network_volume", "training", "artifacts"}
        assert not forbidden & set(manifest)
        for planning_key in ("identity_set", "captions", "stratum_data", "allocation"):
            assert planning_key not in manifest


def test_pilot_manifests_carry_the_expansion03_time_and_disk_overrides(pilot_manifest_paths):
    for path in pilot_manifest_paths.values():
        manifest = pod.load_manifest(path)
        assert manifest["job_timeout_seconds"] == 360
        assert manifest["readiness_timeout_seconds"] == 900
        assert manifest["max_minutes"] == 82
        assert manifest["container_disk_gb"] == 60
        assert manifest["volume_gb"] == 0
        assert 900 + 3 * 360 + 300 <= manifest["max_minutes"] * 60


def test_pilot_manifests_are_byte_for_byte_reproducible(tmp_path):
    out1, out2 = tmp_path / "one", tmp_path / "two"
    paths1 = bvs.build_pilot_manifests(
        PERSONA, BASE_MANIFEST, MULTIREF_WORKFLOW, VARIATION_WORKFLOW, TEMPLATES, out1,
    )
    paths2 = bvs.build_pilot_manifests(
        PERSONA, BASE_MANIFEST, MULTIREF_WORKFLOW, VARIATION_WORKFLOW, TEMPLATES, out2,
    )
    for arm in ("A", "B"):
        assert paths1[arm].read_bytes() == paths2[arm].read_bytes()


def test_pilot_summary_reports_cells_arms_denoise_rungs_and_ceiling(persona, allocation):
    base_manifest = bvs._load_base_manifest(BASE_MANIFEST)
    pilot = bvs.pilot_cells(allocation)
    summary = bvs.pilot_summary(base_manifest, pilot)
    assert "3 cells" in summary
    assert "2 arms" in summary
    assert "6 jobs" in summary
    assert "0.28" in summary and "0.35" in summary
    assert "$1.09" in summary or "$1.10" in summary


# ---------------------------------------------------------------------------
# Full manifests — both arms, 10 jobs/shard, exclude pilot cells
# ---------------------------------------------------------------------------


@pytest.fixture
def full_manifest_paths(tmp_path):
    return bvs.build_full_manifests(
        PERSONA, BASE_MANIFEST, MULTIREF_WORKFLOW, VARIATION_WORKFLOW, TEMPLATES, tmp_path,
    )


def test_full_manifests_shard_the_33_remaining_cells_10_per_shard_both_arms(full_manifest_paths):
    for arm in ("A", "B"):
        assert len(full_manifest_paths[arm]) == 4
        counts = [len(pod.load_manifest(p)["jobs"]) for p in full_manifest_paths[arm]]
        assert counts == [10, 10, 10, 3]
        assert sum(counts) == 33


def test_full_manifest_filenames_follow_the_full_arm_shard_nn_pattern(full_manifest_paths):
    for arm in ("A", "B"):
        names = [p.name for p in full_manifest_paths[arm]]
        assert names == [
            f"creator-001-expansion-03-full-{arm}-shard-{i:02d}.yaml" for i in range(1, 5)
        ]


def test_full_manifests_never_include_the_pilot_cells(full_manifest_paths):
    pilot_output_stems = {f"exp03-{a}-t{TEMPLATE_IDS.index(t) + 1:02d}" for a, t in PILOT_KEYS}
    for arm in ("A", "B"):
        for path in full_manifest_paths[arm]:
            manifest = pod.load_manifest(path)
            for job in manifest["jobs"]:
                base_name = job["output_name"][len("c001-"):]
                if arm == "A":
                    base_name = base_name[: -len("-mechA")]
                assert base_name not in pilot_output_stems


def test_full_manifests_pass_require_manifest_validation(full_manifest_paths):
    for arm in ("A", "B"):
        for path in full_manifest_paths[arm]:
            manifest = pod.load_manifest(path)
            assert pod.require_manifest(manifest, path, allow_missing_uploads=True) is None


def test_full_manifests_are_byte_for_byte_reproducible(tmp_path):
    out1, out2 = tmp_path / "one", tmp_path / "two"
    paths1 = bvs.build_full_manifests(
        PERSONA, BASE_MANIFEST, MULTIREF_WORKFLOW, VARIATION_WORKFLOW, TEMPLATES, out1,
    )
    paths2 = bvs.build_full_manifests(
        PERSONA, BASE_MANIFEST, MULTIREF_WORKFLOW, VARIATION_WORKFLOW, TEMPLATES, out2,
    )
    for arm in ("A", "B"):
        for p1, p2 in zip(paths1[arm], paths2[arm]):
            assert p1.read_bytes() == p2.read_bytes()


# ---------------------------------------------------------------------------
# --dry-run offline, for every manifest this builder emits
# ---------------------------------------------------------------------------


def test_every_pilot_and_full_manifest_passes_dry_run_offline(
    tmp_path, pilot_manifest_paths, full_manifest_paths
):
    all_paths = list(pilot_manifest_paths.values())
    for arm in ("A", "B"):
        all_paths.extend(full_manifest_paths[arm])
    assert len(all_paths) == 2 + 8

    for index, path in enumerate(all_paths):
        out = tmp_path / f"dry-{index:02d}"
        code = pod.main(["run", "--manifest", str(path), "--dry-run", "--out", str(out)])
        assert code == 0, f"--dry-run failed for {path.name}"
        assert (out / "run.json").is_file()
