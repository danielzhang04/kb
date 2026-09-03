import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image

PIPELINE = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


blind_pool = load_module("figment_pipeline_blind_pool_under_test", PIPELINE / "blind_pool.py")


def _make_images(dir_path, names):
    dir_path.mkdir(parents=True, exist_ok=True)
    for name in names:
        Image.new("RGB", (4, 4), "white").save(dir_path / f"{name}.png")


def test_build_pool_manifest_is_arm_free_and_key_lives_outside_pool(tmp_path):
    arm_a = tmp_path / "arm-a"
    arm_b = tmp_path / "arm-b"
    _make_images(arm_a, ["a1", "a2"])
    _make_images(arm_b, ["b1", "b2"])
    pool = tmp_path / "pool"
    key = tmp_path / "key.json"

    assert blind_pool.main([
        "build", "--arm", f"A={arm_a}", "--arm", f"B={arm_b}",
        "--pool", str(pool), "--key", str(key), "--seed", "20260903",
    ]) == 0

    manifest = json.loads((pool / "manifest.json").read_text(encoding="utf-8"))
    for entry in manifest["images"]:
        assert "arm" not in entry
        assert "prompt_setup_id" not in entry
        assert set(entry) == {"image_id", "path", "review_status", "parked_reasons"}

    key_data = json.loads(key.read_text(encoding="utf-8"))
    assert len(key_data["images"]) == 4
    assert key.resolve().parent != pool.resolve()


def test_reveal_taxonomy_represents_all_seven_axes(tmp_path):
    arm_a = tmp_path / "arm-a"
    _make_images(arm_a, ["a1", "a2", "a3", "a4"])
    pool = tmp_path / "pool"
    key = tmp_path / "key.json"

    assert blind_pool.main([
        "build", "--arm", f"A={arm_a}", "--pool", str(pool), "--key", str(key), "--seed", "1",
    ]) == 0

    manifest_path = pool / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    by_id = {e["image_id"]: e for e in manifest["images"]}
    ids = sorted(by_id)

    # One clean pass, one quality-axis parked, one safety-only failure (review_status
    # stays "verified" per the orthogonality rule), one image left unreviewed.
    by_id[ids[0]].update(review_status="verified", parked_reasons=[], safety_failed=False, safety_reasons=[])
    by_id[ids[1]].update(
        review_status="parked", parked_reasons=["hands: hard-fail"],
        safety_failed=False, safety_reasons=[],
    )
    by_id[ids[2]].update(
        review_status="verified", parked_reasons=[],
        safety_failed=True, safety_reasons=["garment_integrity: fail", "real_person_resemblance: flag"],
    )
    # ids[3] stays "unreviewed" — untouched.
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    report_path = tmp_path / "report.json"
    assert blind_pool.main([
        "reveal", "--manifest", str(manifest_path), "--key", str(key), "--out", str(report_path),
    ]) == 0

    report = json.loads(report_path.read_text(encoding="utf-8"))
    arm_a_report = report["A"]
    assert arm_a_report["total"] == 4
    assert arm_a_report["verified"] == 2
    assert arm_a_report["parked"] == 1
    assert arm_a_report["unreviewed"] == 1
    failures = arm_a_report["axis_failures"]
    assert failures["hands: hard-fail"] == 1
    assert failures["garment_integrity: fail"] == 1
    assert failures["real_person_resemblance: flag"] == 1


def test_reveal_never_needs_source_path_or_arm_from_the_manifest_alone(tmp_path):
    # The manifest itself never carries arm/source info — reveal must resolve arm
    # strictly through the key, proving blind_pool never leaks it into the manifest
    # a grader is handed.
    arm_a = tmp_path / "arm-a"
    _make_images(arm_a, ["a1"])
    pool = tmp_path / "pool"
    key = tmp_path / "key.json"
    assert blind_pool.main([
        "build", "--arm", f"A={arm_a}", "--pool", str(pool), "--key", str(key), "--seed", "1",
    ]) == 0
    manifest_text = (pool / "manifest.json").read_text(encoding="utf-8")
    assert "arm-a" not in manifest_text
    assert '"arm"' not in manifest_text
    assert str(arm_a.resolve()) not in manifest_text
