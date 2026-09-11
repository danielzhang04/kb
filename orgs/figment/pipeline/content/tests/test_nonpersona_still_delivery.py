"""Focused integration tests for nonpersona_still_delivery.

The authority in these tests is deliberately real: content brief -> C/D/E preparation
-> native compiler -> synthetic live-shaped retained run -> visual ruling.  Synthetic
PNG bytes and a synthetic human attribution stand in only for the external producer and
reviewer; they are not an approval or a delivery-quality judgment.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import errno
import struct
import subprocess
import sys
import zlib
from pathlib import Path

import pytest
from PIL import Image, PngImagePlugin

from orgs.figment.pipeline.content import nonpersona_native as native
from orgs.figment.pipeline.content import nonpersona_retained as retained
from orgs.figment.pipeline.content import nonpersona_still_delivery as delivery
from orgs.figment.pipeline.content import nonpersona_visual_ruling as ruling_mod
from orgs.figment.pipeline.content.tests.test_nonpersona_native import (  # noqa: F401
    _compile, _snapshot, _write_json, root,
)
from orgs.figment.pipeline.content.tests.test_nonpersona_retained import DAY, POD_ID, USD
from orgs.figment.pipeline.content.tests.test_nonpersona_visual_ruling import ACCEPT, DECIDED_AT


REPO = Path(__file__).resolve().parents[5]
NATIVE = (1448, 2176)
TARGET = (1080, 1440)
Error = delivery.NonpersonaStillDeliveryError


def _pod():
    return native._train()._pod_runner_module()


def _chunk(kind: bytes, payload: bytes) -> bytes:
    return (struct.pack(">I", len(payload)) + kind + payload +
            struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF))


def _insert_chunk(png: bytes, kind: bytes, payload: bytes) -> bytes:
    """Insert an ancillary chunk after IHDR without relying on Pillow's truthiness."""
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and png[12:16] == b"IHDR"
    ihdr_end = 8 + 4 + 4 + struct.unpack(">I", png[8:12])[0] + 4
    return png[:ihdr_end] + _chunk(kind, payload) + png[ihdr_end:]


def _gradient_png(prompt: str, *, salt: int, mode: str = "RGB",
                  metadata: str | None = None, orientation: int | None = None) -> bytes:
    """A nonuniform source: crop location and LANCZOS pixels both matter."""
    width, height = NATIVE
    pixels = bytearray(width * height * 3)
    position = 0
    for y in range(height):
        for x in range(width):
            pixels[position] = (17 * x + 13 * y + salt) & 255
            pixels[position + 1] = ((x // 19) * 29 ^ (y // 23) * 31 ^ salt) & 255
            pixels[position + 2] = (7 * x + 11 * y + (x // 37) * (y // 41) + salt) & 255
            position += 3
    image = Image.frombytes("RGB", NATIVE, bytes(pixels))
    if mode == "RGBA":
        image = image.convert("RGBA")
        image.putalpha(127)
    elif mode == "P":
        image = image.convert("P")
    info = PngImagePlugin.PngInfo()
    info.add_text("prompt", prompt)  # allowed upstream and deliberately stripped on delivery
    exif = None
    if orientation is not None:
        exif = Image.Exif()
        exif[274] = orientation
    buffer = io.BytesIO()
    image.save(buffer, "PNG", pnginfo=info, exif=exif)
    data = buffer.getvalue()
    if orientation is None:
        assert b"eXIf" not in data  # successful real-chain fixture must exercise absent-orientation handling
    if metadata == "transparency":
        return _insert_chunk(data, b"tRNS", b"\0\0\0\0\0\0")
    if metadata == "icc_none":
        # Pillow reports an invalid iCCP profile as an icc_profile key with a falsey value.
        data = _insert_chunk(data, b"iCCP", b"bad\0\0not-a-zlib-stream")
        with Image.open(io.BytesIO(data)) as decoded:
            assert "icc_profile" in decoded.info and decoded.info["icc_profile"] is None
        return data
    if metadata == "gamma_zero":
        return _insert_chunk(data, b"gAMA", struct.pack(">I", 0))
    if metadata == "srgb_zero":
        return _insert_chunk(data, b"sRGB", b"\0")
    if metadata == "chromaticity":
        return _insert_chunk(data, b"cHRM", b"\0" * 32)
    return data


def _live(root: Path, tag: str, taxonomy: str = "D", *, mode: str = "RGB",
          metadata: str | None = None, orientation: int | None = None) -> tuple[Path, dict]:
    """Build the actual producer chain, changing only the fake runner's PNG bytes."""
    out, _ = _compile(root, tag, taxonomy)
    out_dir, pod = root / out, _pod()
    manifest_path = out_dir / native.MANIFEST_NAME
    manifest = json.loads(manifest_path.read_bytes())
    base, fields = pod.load_workflow(manifest, manifest_path), pod.manifest_seed_fields(manifest)
    graphs = [pod.apply_job(base, job, fields) for job in manifest["jobs"]]
    pod.append_cost_row(root / "ledger", pod.gpu_model_label(manifest["gpu"]["type"]),
                        f"pod-create {POD_ID}-{tag}", USD, ledger_day=DAY)
    run_dir = out_dir / "run"
    run_dir.mkdir()
    jobs = []
    for number, (job, graph) in enumerate(zip(manifest["jobs"], graphs), start=1):
        data = _gradient_png(json.dumps(graph), salt=number * 47, mode=mode,
                             metadata=metadata if number == 1 else None,
                             orientation=orientation if number == 1 else None)
        path = f"{job['output_name']}.png"
        (run_dir / path).write_bytes(data)
        jobs.append({"job": number, "output_name": job["output_name"], "seed": job["seed"],
                     "prompt_id": f"synthetic-{tag}-{number}", "seconds": 12.5,
                     "files": [{"path": path, "bytes": len(data)}]})
    _write_json(run_dir / "run.json", {
        "schema": retained.RUN_SCHEMA, "dry_run": False, "pod_id": f"{POD_ID}-{tag}",
        "estimated_actual_usd": USD, "ledger_day": DAY, "termination_verified": True,
        "placement_attempts": [{"pod_id": f"{POD_ID}-{tag}", "estimated_actual_usd": USD,
                                "termination_verified": True}],
        "jobs": jobs, "uploads": [], "artifacts": [],
    })
    return out, retained.record_nonpersona_retained(root=root, out=out)


def _brief(root: Path, tag: str) -> dict:
    return json.loads((root / "out" / f"{tag}-prep.json").read_bytes())["brief"]


def _ruling(root: Path, out: Path, record: dict, tag: str) -> tuple[str, str]:
    data = {
        "schema": "figment/nonpersona-visual-ruling@1",
        "retained": {"out": out.as_posix(), "record_sha256": retained._digest(
            (root / out / retained.RECORD_NAME).read_bytes())},
        "image": {key: record["images"][0][key]
                  for key in ("cell_id", "path", "sha256", "width", "height")},
        "brief": _brief(root, tag), "slot": record["slot"],
        "authority": "human-visual-ruling", "criteria": ACCEPT,
        "delivery_quality": "not-assessed", "decision": "accept-native",
        "decided_by": "synthetic-reviewer@example.test", "decided_at": DECIDED_AT,
        "note": "synthetic external human attribution fixture",
    }
    raw = (json.dumps(data, indent=2, sort_keys=True) + "\n").encode("utf-8")
    (root / "ruling.json").write_bytes(raw)
    return "ruling.json", retained._digest(raw)


def _request(root: Path, ruling: tuple[str, str], crop: list[object], *, name: str = "request.json",
             extra: dict | None = None, raw: bytes | None = None) -> str:
    if raw is None:
        payload = {"schema": "figment/nonpersona-still-delivery-request@1",
                   "ruling": {"path": ruling[0], "sha256": ruling[1]}, "crop_box": crop}
        if extra:
            payload.update(extra)
        raw = (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8")
    (root / name).write_bytes(raw)
    return name


def _authority(root: Path, ruling: tuple[str, str]) -> dict:
    result = ruling_mod.validate_nonpersona_visual_ruling(root=root, path=ruling[0], expected_sha256=ruling[1])
    fields = ("schema", "not_promotable", "ruling", "retained", "image", "brief", "creator", "slot",
              "native_dimensions", "delivery_target", "authority", "criteria", "decision", "decided_by",
              "decided_at", "delivery_quality", "delivery_transform")
    return {key: result[key] for key in fields}


def _oracle(source: bytes, crop: tuple[int, int, int, int], target: tuple[int, int]) -> tuple[bytes, bytes]:
    with Image.open(io.BytesIO(source)) as image:
        rendered = image.crop(crop).resize(target, Image.Resampling.LANCZOS)
        rgb = rendered.tobytes()
    fresh = Image.frombytes("RGB", target, rgb)
    encoded = io.BytesIO()
    fresh.save(encoded, "PNG", optimize=False, compress_level=9)
    return rgb, encoded.getvalue()


def _sources(root: Path) -> dict[str, bytes]:
    """All upstream files, including all three images and every record, before delivery."""
    return _snapshot(root)


def _assert_sources_unchanged(root: Path, before: dict[str, bytes]) -> None:
    after = _snapshot(root)
    assert {path: after[path] for path in before} == before


def _final(out_dir: Path) -> Path:
    return out_dir / "nonpersona-still-delivery.json"


def _replace_canonical_receipt(out_dir: Path, receipt: dict) -> None:
    """Keep receipt evidence internally consistent while testing reconstruction, not hashes."""
    encoded = (json.dumps(receipt, indent=2, sort_keys=True) + "\n").encode("utf-8")
    pending, final = out_dir / delivery.PENDING_RECEIPT_NAME, _final(out_dir)
    pending.unlink()
    final.unlink()
    pending.write_bytes(encoded)
    os.link(pending, final)


@pytest.mark.parametrize("taxonomy", ["C", "D", "E"])
def test_real_cde_chain_materializes_exact_oracle_and_revalidates(root: Path, taxonomy: str) -> None:
    out, retained_record = _live(root, f"real-{taxonomy}", taxonomy)
    ruling = _ruling(root, out, retained_record, f"real-{taxonomy}")
    request = _request(root, ruling, [0, 0, 3, 4])  # deliberate 3x4 upscaling: quality remains unassessed
    before = _sources(root)
    delivery_out = Path("out") / f"delivery-{taxonomy}"

    receipt = delivery.materialize_nonpersona_still_delivery(
        root=root, request_path=request, out=delivery_out,
    )
    out_dir = root / delivery_out
    source = (root / out / retained_record["images"][0]["path"]).read_bytes()
    expected_rgb, expected_png = _oracle(source, (0, 0, 3, 4), TARGET)
    actual = (out_dir / "delivery.png").read_bytes()
    with Image.open(io.BytesIO(actual)) as decoded:
        assert decoded.mode == "RGB" and decoded.size == TARGET and decoded.tobytes() == expected_rgb
        assert not decoded.info  # prompt/workflow and other ancillary source text was stripped
    assert actual == expected_png  # independent complete encoder-byte oracle, not just a hash

    assert set(receipt) == {"schema", "stage", "not_promotable", "delivery_quality", "out", "request",
                            "source_authority", "operation", "runtime", "output"}
    assert receipt["schema"] == "figment/nonpersona-still-delivery@1"
    assert receipt["stage"] == "materialized-not-reviewed"
    assert receipt["not_promotable"] is True and receipt["delivery_quality"] == "not-assessed"
    assert receipt["out"] == delivery_out.as_posix()
    request_bytes = (root / request).read_bytes()
    assert receipt["request"] == {"path": request, "bytes": len(request_bytes),
                                   "sha256": retained._digest(request_bytes)}
    assert receipt["source_authority"] == _authority(root, ruling)
    assert receipt["operation"] == {
        "op": "crop-resize", "coordinate_space": "stored-pixel-grid-half-open", "crop_box": [0, 0, 3, 4],
        "crop_dimensions": {"width": 3, "height": 4}, "resample": "Pillow.Image.Resampling.LANCZOS",
        "color": "stored-untagged-RGB-no-conversion",
        "source_metadata_policy": "reject-icc-gamma-srgb-chromaticity-transparency-strip-other-ancillary",
        "output_format": "PNG", "encoder": {"optimize": False, "compress_level": 9},
        "output_metadata": "none",
    }
    assert receipt["output"] == {
        "path": "delivery.png", "bytes": len(expected_png), "sha256": retained._digest(expected_png),
        "width": 1080, "height": 1440, "mode": "RGB", "rgb_sha256": retained._digest(expected_rgb),
    }
    assert not {"approved", "accept", "slot_fit", "published", "quality_pass", "authenticated"} & set(receipt)
    assert (out_dir / delivery.PENDING_RECEIPT_NAME).read_bytes() == _final(out_dir).read_bytes()
    assert delivery.revalidate_nonpersona_still_delivery(root=root, out=delivery_out) == receipt
    _assert_sources_unchanged(root, before)


def test_two_fresh_outputs_and_cli_are_deterministic(root: Path) -> None:
    out, record = _live(root, "deterministic")
    ruling = _ruling(root, out, record, "deterministic")
    request = _request(root, ruling, [10, 20, 13, 24])
    first, second = Path("out/delivery-one"), Path("out/delivery-two")
    delivery.materialize_nonpersona_still_delivery(root=root, request_path=request, out=first)
    delivery.materialize_nonpersona_still_delivery(root=root, request_path=request, out=second)
    assert (root / first / "delivery.png").read_bytes() == (root / second / "delivery.png").read_bytes()
    assert delivery.revalidate_nonpersona_still_delivery(root=root, out=first)["output"]["rgb_sha256"] == \
        delivery.revalidate_nonpersona_still_delivery(root=root, out=second)["output"]["rgb_sha256"]

    third = Path("out/delivery-cli")
    command = [sys.executable, "-m", "orgs.figment.pipeline.content.nonpersona_still_delivery", "build",
               "--root", str(root), "--request", request, "--out", third.as_posix()]
    built = subprocess.run(command, cwd=REPO, capture_output=True, text=True, timeout=600)
    assert built.returncode == 0, built.stderr
    checked = subprocess.run([*command[:3], "revalidate", "--root", str(root), "--out", third.as_posix()],
                             cwd=REPO, capture_output=True, text=True, timeout=600)
    assert checked.returncode == 0, checked.stderr


def test_nonzero_downsampling_crop_has_complete_independent_oracle(root: Path) -> None:
    out, record = _live(root, "downsample")
    ruling = _ruling(root, out, record, "downsample")
    crop = [100, 100, 1396, 1828]  # 1296x1728 exact 3:4, then genuine LANCZOS downsampling
    request = _request(root, ruling, crop)
    delivery_out = Path("out/delivery-downsample")
    receipt = delivery.materialize_nonpersona_still_delivery(root=root, request_path=request, out=delivery_out)
    source = (root / out / record["images"][0]["path"]).read_bytes()
    expected_rgb, expected_png = _oracle(source, tuple(crop), TARGET)
    actual = (root / delivery_out / "delivery.png").read_bytes()
    with Image.open(io.BytesIO(actual)) as image:
        assert image.tobytes() == expected_rgb
    assert actual == expected_png


def test_crop_schema_bounds_ratio_and_full_current_frame_reject(root: Path) -> None:
    out, record = _live(root, "crops")
    ruling = _ruling(root, out, record, "crops")
    invalid = {
        "bool": [True, 0, 3, 4], "float": [0, 0, 3.0, 4], "length": [0, 0, 3],
        "zero": [0, 0, 0, 4], "outside": [0, 0, 1449, 4], "ratio": [0, 0, 4, 4],
        "full_current_native": [0, 0, *NATIVE],
    }
    before = _sources(root)
    for name, crop in invalid.items():
        request = _request(root, ruling, crop, name=f"{name}.json")
        target = Path("out") / f"bad-{name}"
        with pytest.raises(Error):
            delivery.materialize_nonpersona_still_delivery(root=root, request_path=request, out=target)
        assert not _final(root / target).exists()
    extra = _request(root, ruling, [0, 0, 3, 4], name="free-target.json", extra={"target": [2, 2]})
    with pytest.raises(Error):
        delivery.materialize_nonpersona_still_delivery(root=root, request_path=extra, out="out/bad-extra")
    _assert_sources_unchanged(root, before)


def test_request_duplicate_and_nonfinite_json_rejected(root: Path) -> None:
    out, record = _live(root, "request-json")
    ruling = _ruling(root, out, record, "request-json")
    base = json.dumps({"schema": "figment/nonpersona-still-delivery-request@1",
                       "ruling": {"path": ruling[0], "sha256": ruling[1]}, "crop_box": [0, 0, 3, 4]})
    for name, raw in {
        "duplicate.json": ('{"schema":"wrong",' + base[1:]).encode(),
        "nonfinite.json": ('{"x":NaN,' + base[1:]).encode(),
        "overflow.json": ('{"x":1e999,' + base[1:]).encode(),
        "malformed.json": b"{",
    }.items():
        request = _request(root, ruling, [], name=name, raw=raw)
        with pytest.raises(Error):
            delivery.materialize_nonpersona_still_delivery(root=root, request_path=request, out=f"out/{name}")


@pytest.mark.parametrize(("mode", "metadata", "orientation"), [
    ("RGBA", None, None), ("P", None, None), ("RGB", "transparency", None),
    ("RGB", "icc_none", None), ("RGB", "gamma_zero", None), ("RGB", "srgb_zero", None),
    ("RGB", "chromaticity", None), ("RGB", None, 6),
])
def test_real_nvr_authority_rejects_unsupported_source_modes_metadata_and_orientation(
    root: Path, mode: str, metadata: str | None, orientation: int | None,
) -> None:
    # The retained/NVR authority intentionally admits these so this reaches the delivery decoder.
    tag = f"metadata-{mode}-{metadata or orientation or 'plain'}"
    out, record = _live(root, tag, mode=mode, metadata=metadata, orientation=orientation)
    ruling = _ruling(root, out, record, tag)
    request = _request(root, ruling, [0, 0, 3, 4])
    before = _sources(root)
    with pytest.raises(Error):
        delivery.materialize_nonpersona_still_delivery(root=root, request_path=request, out="out/reject-metadata")
    assert not _final(root / "out/reject-metadata").exists()
    _assert_sources_unchanged(root, before)


def test_linked_request_and_ruling_are_refused(root: Path) -> None:
    out, record = _live(root, "links")
    ruling = _ruling(root, out, record, "links")
    request = _request(root, ruling, [0, 0, 3, 4])
    os.link(root / request, root / "request-alias.json")
    with pytest.raises(Error):
        delivery.materialize_nonpersona_still_delivery(root=root, request_path=request, out="out/linked-request")

    # A fresh request lets NVR, rather than an assignment/binder substitute, reject linked authority.
    (root / "request-alias.json").unlink()
    os.link(root / ruling[0], root / "ruling-alias.json")
    request = _request(root, ruling, [0, 0, 3, 4], name="request-two.json")
    with pytest.raises(Error):
        delivery.materialize_nonpersona_still_delivery(root=root, request_path=request, out="out/linked-ruling")


def test_reparse_request_is_refused(root: Path) -> None:
    out, record = _live(root, "reparse")
    ruling = _ruling(root, out, record, "reparse")
    request = _request(root, ruling, [0, 0, 3, 4])
    linked = root / "symlink-delivery-request.json"
    assert not linked.exists() and not linked.is_symlink()
    try:
        os.symlink(root / request, linked)
    except OSError as exc:  # Windows requires Developer Mode or SeCreateSymbolicLink privilege.
        if getattr(exc, "winerror", None) == 1314 or exc.errno in {errno.EACCES, errno.EPERM, errno.ENOTSUP}:
            pytest.skip(f"symlink creation is unavailable on this host: {exc}")
        raise
    assert linked.is_symlink()
    with pytest.raises(Error):
        delivery.materialize_nonpersona_still_delivery(root=root, request_path=linked.name, out="out/reparse")


def test_real_nvr_research_and_reject_dispositions_are_not_delivery_authority(root: Path) -> None:
    out, record = _live(root, "dispositions")
    original = _ruling(root, out, record, "dispositions")
    original_bytes = (root / original[0]).read_bytes()
    for name, changes in {
        "research": {"authority": "research-disposition"},
        "reject": {"decision": "reject"},
    }.items():
        rule_path = root / original[0]
        data = json.loads(original_bytes)
        data.update(changes)
        raw = (json.dumps(data, indent=2, sort_keys=True) + "\n").encode("utf-8")
        rule_path.write_bytes(raw)
        ruling = (original[0], retained._digest(raw))
        # This proves the synthetic external ruling is valid NVR input, not a fake authority result.
        ruling_mod.validate_nonpersona_visual_ruling(root=root, path=ruling[0], expected_sha256=ruling[1])
        request = _request(root, ruling, [0, 0, 3, 4], name=f"{name}-request.json")
        with pytest.raises(Error):
            delivery.materialize_nonpersona_still_delivery(root=root, request_path=request, out=f"out/{name}")


def test_source_mutation_between_render_passes_leaves_no_final_and_sources_restore(root: Path, monkeypatch) -> None:
    out, record = _live(root, "source-race")
    ruling = _ruling(root, out, record, "source-race")
    request = _request(root, ruling, [0, 0, 3, 4])
    source = root / out / record["images"][0]["path"]
    original, before = source.read_bytes(), _sources(root)
    real_render, calls = delivery._render_png, 0

    def mutate_after_first(*args):
        nonlocal calls
        calls += 1
        value = real_render(*args)
        if calls == 1:
            source.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
        return value

    monkeypatch.setattr(delivery, "_render_png", mutate_after_first)
    try:
        with pytest.raises(Error):
            delivery.materialize_nonpersona_still_delivery(root=root, request_path=request, out="out/source-race")
    finally:
        source.write_bytes(original)
    assert not _final(root / "out/source-race").exists()
    _assert_sources_unchanged(root, before)


@pytest.mark.parametrize("case", [
    "encoded_same_rgb", "pixel", "missing_final", "pending_differs", "runtime_python",
    "runtime_pillow", "runtime_zlib", "code_delivery", "code_nvr",
])
def test_revalidation_reconstructs_pixels_bytes_receipt_and_runtime(root: Path, monkeypatch, case: str) -> None:
    out, record = _live(root, f"revalidate-{case}")
    ruling = _ruling(root, out, record, f"revalidate-{case}")
    request = _request(root, ruling, [0, 0, 3, 4])
    delivery_out = Path("out") / f"delivery-{case}"
    receipt = delivery.materialize_nonpersona_still_delivery(root=root, request_path=request, out=delivery_out)
    out_dir, image_path, final = root / delivery_out, root / delivery_out / "delivery.png", _final(root / delivery_out)
    if case == "encoded_same_rgb":
        with Image.open(image_path) as image:
            pixels = image.tobytes()
        info = PngImagePlugin.PngInfo(); info.add_text("changed", "encoder bytes differ")
        Image.frombytes("RGB", TARGET, pixels).save(image_path, "PNG", pnginfo=info)
        with Image.open(image_path) as image:
            assert image.tobytes() == pixels
    elif case == "pixel":
        with Image.open(image_path) as image:
            changed = bytearray(image.tobytes())
        changed[0] ^= 1
        Image.frombytes("RGB", TARGET, bytes(changed)).save(image_path, "PNG")
    if case in {"encoded_same_rgb", "pixel"}:
        encoded = image_path.read_bytes()
        with Image.open(io.BytesIO(encoded)) as image:
            rgb = image.tobytes()
        receipt["output"] = {"path": "delivery.png", "bytes": len(encoded),
                              "sha256": retained._digest(encoded), "width": 1080, "height": 1440,
                              "mode": "RGB", "rgb_sha256": retained._digest(rgb)}
        _replace_canonical_receipt(out_dir, receipt)
    elif case == "missing_final":
        final.unlink()
    elif case == "pending_differs":
        pending = out_dir / delivery.PENDING_RECEIPT_NAME
        pending.unlink()  # split the intentional final hardlink before replacing only pending
        pending.write_bytes(b"{}\n")
    else:
        current = json.loads(json.dumps(delivery._runtime()))
        if case == "runtime_python":
            current["python_version"] = "different-python"
        elif case == "runtime_pillow":
            current["pillow_version"] = "different-pillow"
        elif case == "runtime_zlib":
            current["zlib_runtime_version"] = "different-zlib"
        elif case == "code_delivery":
            current["code_sha256"]["nonpersona_still_delivery.py"] = "0" * 64
        else:
            current["code_sha256"]["nonpersona_visual_ruling.py"] = "0" * 64
        monkeypatch.setattr(delivery, "_runtime", lambda: current)
    with pytest.raises(Error):
        delivery.revalidate_nonpersona_still_delivery(root=root, out=delivery_out)


def test_revalidation_refuses_output_mutated_during_second_real_authority_pass(root: Path, monkeypatch) -> None:
    out, record = _live(root, "output-race")
    ruling = _ruling(root, out, record, "output-race")
    request = _request(root, ruling, [0, 0, 3, 4])
    delivery_out = Path("out/delivery-output-race")
    delivery.materialize_nonpersona_still_delivery(root=root, request_path=request, out=delivery_out)
    output = root / delivery_out / "delivery.png"
    source_before = {
        path: data for path, data in _sources(root).items()
        if not path.startswith(delivery_out.as_posix() + "/")
    }
    real_authority, calls = delivery._source_authority, 0

    def authority(current_root: Path, current_request: dict) -> dict:
        nonlocal calls
        calls += 1
        result = real_authority(current_root, current_request)  # always delegates to real NVR authority
        if calls == 2:
            output.write_bytes(output.read_bytes() + b"\0")
        return result

    monkeypatch.setattr(delivery, "_source_authority", authority)
    with pytest.raises(Error):
        delivery.revalidate_nonpersona_still_delivery(root=root, out=delivery_out)
    assert calls == 2 and _final(root / delivery_out).exists()
    _assert_sources_unchanged(root, source_before)


@pytest.mark.parametrize("failure", ["delivery_write", "pending_write", "fsync", "initial_render",
                                       "rerender", "pending_mutation", "link"])
def test_precommit_failures_preserve_partial_without_final_or_retry(
    root: Path, monkeypatch, failure: str,
) -> None:
    out, record = _live(root, f"failure-{failure}")
    ruling = _ruling(root, out, record, f"failure-{failure}")
    request = _request(root, ruling, [0, 0, 3, 4])
    target, before = Path("out") / f"failure-output-{failure}", _sources(root)
    if failure in {"delivery_write", "pending_write"}:
        real_write = delivery._write_exclusive

        def fail_write(path, data, label):
            if Path(path).name == ("delivery.png" if failure == "delivery_write" else delivery.PENDING_RECEIPT_NAME):
                raise OSError(f"injected {failure}")
            return real_write(path, data, label)

        monkeypatch.setattr(delivery, "_write_exclusive", fail_write)
    elif failure == "fsync":
        monkeypatch.setattr(delivery, "_fsync_file", lambda handle: (_ for _ in ()).throw(OSError("injected fsync")))
    elif failure in {"initial_render", "rerender", "pending_mutation"}:
        real_render, calls = delivery._render_png, 0

        def controlled_render(*args):
            nonlocal calls
            calls += 1
            if failure == "initial_render" and calls == 1:
                raise OSError("injected initial render")
            if failure == "rerender" and calls == 2:
                raise OSError("injected rerender")
            result = real_render(*args)
            if failure == "pending_mutation" and calls == 2:
                pending = root / target / delivery.PENDING_RECEIPT_NAME
                assert pending.exists()
                pending.write_bytes(b"mutated pending receipt\n")
            return result

        monkeypatch.setattr(delivery, "_render_png", controlled_render)
    else:
        monkeypatch.setattr(delivery.os, "link", lambda *_: (_ for _ in ()).throw(OSError("injected link")))

    with pytest.raises(Error):
        delivery.materialize_nonpersona_still_delivery(root=root, request_path=request, out=target)
    out_dir = root / target
    if failure == "initial_render":
        # Rendering occurs before directory creation. Once the one-shot fault is gone,
        # this remains a fresh target and may be materialized normally.
        assert not out_dir.exists()
        receipt = delivery.materialize_nonpersona_still_delivery(root=root, request_path=request, out=target)
        assert delivery.revalidate_nonpersona_still_delivery(root=root, out=target) == receipt
        _assert_sources_unchanged(root, before)
        return
    assert not _final(out_dir).exists()
    assert (out_dir / delivery.PENDING_RECEIPT_NAME).exists() is (
        failure not in {"delivery_write", "pending_write", "fsync"}
    )
    with pytest.raises(Error):
        delivery.revalidate_nonpersona_still_delivery(root=root, out=target)
    with pytest.raises(Error):  # no cleanup and no retry in place
        delivery.materialize_nonpersona_still_delivery(root=root, request_path=request, out=target)
    _assert_sources_unchanged(root, before)


def test_existing_target_is_untouched(root: Path) -> None:
    out, record = _live(root, "existing")
    ruling = _ruling(root, out, record, "existing")
    request = _request(root, ruling, [0, 0, 3, 4])
    target = root / "out" / "existing-target"
    target.mkdir()
    (target / "delivery.png").write_bytes(b"do not overwrite")
    before = _snapshot(target)
    with pytest.raises(Error):
        delivery.materialize_nonpersona_still_delivery(root=root, request_path=request, out="out/existing-target")
    assert _snapshot(target) == before
