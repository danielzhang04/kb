import importlib.util
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image


CALIBRATE = Path(__file__).resolve().parents[1]
PIPELINE = CALIBRATE.parent
spec = importlib.util.spec_from_file_location("grid_run", CALIBRATE / "grid_run.py")
grid_run = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = grid_run
spec.loader.exec_module(grid_run)


def test_variants_apply_replace_and_append():
    replaced = grid_run.apply_variant(
        "adult woman with blue-black hair",
        {"axis": "literalism", "apply": {"type": "replace", "target": "blue-black"}},
        {"name": "natural", "value": "natural jet-black with a cool sheen"},
    )
    assert replaced == "adult woman with natural jet-black with a cool sheen hair"
    appended = grid_run.apply_variant(
        "A phone snapshot. Asian-American woman.",
        {"axis": "film", "apply": {"type": "append"}},
        {"name": "grain", "value": "Fine film grain"},
    )
    assert appended == "A phone snapshot. Fine film grain. Asian-American woman."


def test_age_prompt_variants_are_adult_only():
    axis = grid_run.load_axis(CALIBRATE / "axes" / "age.yaml")
    forbidden = ("child", "teen", "minor", "underage", "adolescent", "girl")
    for variant in axis["variants"]:
        value = variant["value"].lower()
        assert "adult" in value
        assert not any(term in value for term in forbidden)


def test_two_fixed_seeds_and_manifest_passes_harness_dry_run(tmp_path):
    axis = CALIBRATE / "axes" / "makeup.yaml"
    output = tmp_path / "grid.yaml"
    manifest = grid_run.build_manifest(
        PIPELINE / "bakeoff" / "probe-a-zimage.yaml",
        [axis],
        "trial-04-c03-s1-seed-100001",
    )
    grid_run.write_manifest(manifest, output)
    assert [job["seed"] for job in manifest["jobs"]] == [100001, 200002] * 5
    assert len(manifest["jobs"]) == 10
    result = subprocess.run(
        [
            sys.executable,
            str(PIPELINE / "pod" / "runpod_run.py"),
            "run",
            "--manifest",
            str(output),
            "--dry-run",
            "--out",
            str(tmp_path / "dry-run"),
        ],
        cwd=PIPELINE.parents[2],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "preflight cost estimate" in result.stdout + result.stderr


def test_grid01_is_40_single_axis_cells_with_probe_configuration():
    probe_path = PIPELINE / "bakeoff" / "probe-a-zimage.yaml"
    axis_paths = [
        CALIBRATE / "axes" / name
        for name in ("makeup.yaml", "prettiness.yaml", "body.yaml", "age.yaml", "posture.yaml")
    ]
    probe = grid_run.load_document(probe_path)
    manifest = grid_run.build_manifest(
        probe_path,
        axis_paths,
        "trial-04-c03-s1-seed-100001",
        output_prefix="grid01",
        cell_seconds=35,
        bootstrap_minutes=9,
        max_minutes=40,
    )
    assert len(manifest["jobs"]) == 40
    assert manifest["max_minutes"] == 40
    assert manifest["price_usd_per_hour"] == 0.80
    assert manifest["readiness_timeout_seconds"] == 1200
    for key, value in probe.items():
        if key not in {"jobs", "max_minutes"}:
            assert manifest[key] == value

    base_job = grid_run.find_base_job(probe, "trial-04-c03-s1-seed-100001")
    base_prompt = grid_run.read_prompt(base_job)
    jobs_by_name = {job["output_name"]: job for job in manifest["jobs"]}
    assert len(jobs_by_name) == 40
    for axis_path in axis_paths:
        axis = grid_run.load_axis(axis_path)
        for variant in axis["variants"]:
            expected_prompt = base_prompt.replace(
                axis["apply"]["target"], variant["value"], 1
            )
            for seed in axis["seeds"]:
                name = grid_run.output_name(
                    axis["axis"], variant["name"], seed, "grid01"
                )
                job = jobs_by_name[name]
                assert job["seed"] == seed
                assert job["expected_images"] == 1
                assert grid_run.read_prompt(job) == expected_prompt


def test_sheet_layout_is_deterministic(tmp_path):
    axis_path = tmp_path / "axis.yaml"
    axis_path.write_text(json.dumps({
        "axis": "test",
        "description": "synthetic",
        "apply": {"type": "append"},
        "variants": [
            {"name": "one", "value": "one"},
            {"name": "two", "value": "two"},
            {"name": "three", "value": "three"},
        ],
        "seeds": [100001, 200002, 300003],
    }), encoding="utf-8")
    for row, variant in enumerate(("one", "two", "three")):
        for column, seed in enumerate((100001, 200002, 300003)):
            Image.new("RGB", (8, 6), (row * 70, column * 70, 30)).save(
                tmp_path / f"{grid_run.output_name('test', variant, seed)}.png"
            )
    first = tmp_path / "first.jpg"
    second = tmp_path / "second.jpg"
    grid_run.build_sheet(tmp_path, axis_path, first)
    grid_run.build_sheet(tmp_path, axis_path, second)
    assert first.read_bytes() == second.read_bytes()
    with Image.open(first) as image:
        assert image.size == (170 + 3 * 220, 34 + 3 * 220)
