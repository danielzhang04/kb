from pathlib import Path
from scripts.prospecting.executor import enumerate_agent_capabilities
from scripts.prospecting.gate import load_manifest, validate_files, validate_manifest

ROOT=Path(__file__).resolve().parents[3]

MANIFEST = ROOT / "scripts/prospecting/gate_manifest_p2.json"


def test_list_builder_capability_surface_is_typed_and_least_privilege():
    capabilities = set(enumerate_agent_capabilities())
    required = {
        "exec_request:fetch_snapshot", "exec_request:finder_page", "exec_request:vendor_lookup",
    }
    forbidden={"gmail.raw","vendor.raw","browser.raw","shell","credential.read","linkedin.connect","linkedin.message","cookie.import","session.import","class_b.adapter","reference_mcp.connect","discovery.action"}
    assert required <= capabilities and forbidden.isdisjoint(capabilities)

def test_p2_manifest_is_flat_and_enumerates_the_collected_suite():
    manifest = load_manifest(MANIFEST)
    assert set(manifest) == {"phase", "artifacts", "artifact_hashes", "fixtures", "tests", "criteria"}
    assert manifest["phase"] == "P2"
    assert len(manifest["tests"]) >= 58 and manifest["tests"] == sorted(manifest["tests"])
    assert validate_manifest(manifest, "P2", ROOT, MANIFEST) == ()

def test_manifest_names_exact_synthetic_fixtures():
    fixtures = set(load_manifest(MANIFEST)["fixtures"])
    assert {
        "conflicting-providers.json", "job-change.json", "finder-pages.json",
        "linkedin-checkpoint.html", "fetch-snapshot-injection.html", "bakeoff-50.json",
        "vendor/pdl/spot-success.json", "vendor/pdl/spot-not-found.json",
        "vendor/apify/profile-success.json", "vendor/apify/profile-error.json",
        "vendor/hunter/find.json", "vendor/hunter/verify.json",
        "vendor/snov/find.json", "vendor/snov/verify.json",
    } <= fixtures

def test_manifest_numeric_criteria_are_fail_closed():
    criteria = load_manifest(MANIFEST)["criteria"]
    assert criteria["minimum_enumerated_tests"] >= 58
    assert criteria["inspector_minimum"] == 90
    assert all(isinstance(value, int) for value in criteria.values())

def test_manifest_includes_every_named_p2_test_file():
    tests = load_manifest(MANIFEST)["tests"]
    files={node.split("::",1)[0].replace("\\","/") for node in tests}
    assert {
        "scripts/prospecting/tests/test_finder_lanes.py",
        "scripts/prospecting/tests/test_provider_budget.py",
        "scripts/prospecting/tests/test_bakeoff.py",
        "scripts/prospecting/tests/test_browser_guard.py",
        "scripts/prospecting/tests/test_fetcher.py",
        "scripts/prospecting/tests/test_list_builder.py",
        "scripts/prospecting/tests/test_capability_surface.py",
        "scripts/prospecting/tests/test_p2_prerequisite.py",
    } <= files

def test_manifest_validation_rejects_unknown_inventory_and_missing_artifacts(tmp_path):
    import copy
    manifest = load_manifest(MANIFEST)
    changed = copy.deepcopy(manifest)
    changed["tests"].append("unknown.py::test_unknown")
    assert "manifest test does not exist" in "|".join(validate_files(ROOT, changed))
    assert validate_files(ROOT, manifest) == ()
