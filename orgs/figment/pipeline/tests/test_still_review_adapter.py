"""Focused pytest suite for the StillReview 'open' adapter (still_review_adapter.py).

Source-only, source-of-truth review: this module imports the real adapter and
its exact seven dependency sources by explicit path (never installed, never
monkeypatched for the isolated CLI runs), and drives both pure in-process
helper checks and real fresh-process ``python -I -B`` CLI invocations.

No provider/scorer/training authority is exercised. No network or subprocess
spawn is permitted while building fixtures (enforced by the shared
``_OfflineGuard``). Fixture personas/media are entirely synthetic.
"""
from __future__ import annotations

import hashlib
import importlib.util
import itertools
import json
import os
import shutil
import struct
import subprocess
import sys
import uuid
import zlib
import tempfile
from copy import deepcopy
from types import SimpleNamespace
from datetime import datetime, timezone
from pathlib import Path

import pytest

if os.name != "nt":
    pytest.skip("this adapter targets local Windows CPython only", allow_module_level=True)

HERE = Path(__file__).resolve()
PIPELINE = HERE.parents[1]
ADAPTER_REAL = PIPELINE / "still_review_adapter.py"

# ---------------------------------------------------------------------------
# Load the real adapter once for pure-function/unit checks. Never call
# .main()/.observe_open() on THIS shared instance -- those are one-shot.
# ---------------------------------------------------------------------------

_SPEC = importlib.util.spec_from_file_location("test_still_review_adapter_shared", ADAPTER_REAL)
assert _SPEC and _SPEC.loader
adapter = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = adapter
_SPEC.loader.exec_module(adapter)

_FRESH_COUNTER = itertools.count()


def _fresh_adapter_module():
    """A brand-new module object with independent one-shot globals."""
    name = f"test_still_review_adapter_fresh_{next(_FRESH_COUNTER)}"
    spec = importlib.util.spec_from_file_location(name, ADAPTER_REAL)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _fixed_error_bytes() -> bytes:
    return adapter._fixed_error_bytes()


# ---------------------------------------------------------------------------
# Load the existing synthetic-persona helper / offline guard (source supplied).
# ---------------------------------------------------------------------------

_PRODUCERS_SPEC = importlib.util.spec_from_file_location(
    "test_still_review_adapter_producers_dep", HERE.parent / "test_gen_source_read_producers.py",
)
assert _PRODUCERS_SPEC and _PRODUCERS_SPEC.loader
producers = importlib.util.module_from_spec(_PRODUCERS_SPEC)
sys.modules[_PRODUCERS_SPEC.name] = producers
_PRODUCERS_SPEC.loader.exec_module(producers)


# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _restore_fixture_aliases():
    prefixes = ("_figment", "fixture_figment_train_", "fixture_lineage_")
    saved = {name: module for name, module in sys.modules.items() if name.startswith(prefixes)}
    for name in saved:
        del sys.modules[name]
    yield
    for name in tuple(sys.modules):
        if name.startswith(prefixes):
            del sys.modules[name]
    sys.modules.update(saved)

# Pure stdlib PNG byte builders (no PIL, no external decoder).
# ---------------------------------------------------------------------------

def _chunk(ctype: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + ctype + data + struct.pack(">I", zlib.crc32(ctype + data) & 0xFFFFFFFF)


def _ihdr(width, height, bit_depth=8, color_type=2, compression=0, filt=0, interlace=0) -> bytes:
    return struct.pack(">IIBBBBB", width, height, bit_depth, color_type, compression, filt, interlace)


def _rgb_png(width=4, height=4, color=(80, 90, 100)) -> bytes:
    row = b"\x00" + bytes(color) * width
    raw = row * height
    idat = zlib.compress(raw, 9)
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", _ihdr(width, height)) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")


def _palette_png(width=2, height=2) -> bytes:
    plte = bytes((10, 20, 30, 40, 50, 60))
    row = b"\x00" + bytes([0, 1] * width)[: width]
    raw = row * height
    idat = zlib.compress(raw, 9)
    return (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", _ihdr(width, height, bit_depth=8, color_type=3))
            + _chunk(b"PLTE", plte) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b""))


# ---------------------------------------------------------------------------
# PNG structural validation
# ---------------------------------------------------------------------------

def test_validate_png_legal_rgb_returns_dimensions():
    assert adapter._validate_png(_rgb_png(4, 5)) == (4, 5)


def test_validate_png_legal_palette():
    assert adapter._validate_png(_palette_png(2, 2)) == (2, 2)


def test_validate_png_bad_signature_refused():
    data = b"NOTPNGSIG" + _rgb_png()[8:]
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_png(data)


def test_validate_png_truncated_chunk_refused():
    data = _rgb_png()[:20]
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_png(data)


def test_validate_png_bad_crc_refused():
    data = bytearray(_rgb_png())
    data[-5] ^= 0xFF
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_png(bytes(data))


def test_validate_png_ihdr_must_be_first():
    good = _rgb_png()
    sig, ihdr_chunk, rest = good[:8], good[8:8 + 25], good[8 + 25:]
    # Build: signature, IEND-shaped ancillary text chunk first, then IHDR.
    text = _chunk(b"tEXt", b"k\x00v")
    reordered = sig + text + ihdr_chunk + rest
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_png(reordered)


def test_validate_png_duplicate_ihdr_refused():
    good = _rgb_png()
    ihdr_chunk = good[8:8 + 25]
    data = good[:8] + ihdr_chunk + good[8:]
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_png(data)


def test_validate_png_bad_bitdepth_for_color_refused():
    bad = struct.pack(">IIBBBBB", 4, 4, 3, 2, 0, 0, 0)  # bit_depth=3 invalid for color_type=2
    data = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", bad) + _chunk(b"IDAT", zlib.compress(b"\x00" * 64)) + _chunk(b"IEND", b"")
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_png(data)


def test_validate_png_absent_idat_refused():
    data = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", _ihdr(4, 4)) + _chunk(b"IEND", b"")
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_png(data)


def test_validate_png_empty_idat_refused():
    data = (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", _ihdr(4, 4))
            + _chunk(b"IDAT", b"") + _chunk(b"IEND", b""))
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_png(data)


def test_validate_png_noncontiguous_idat_refused():
    idat = zlib.compress(b"\x00" * 64)
    data = (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", _ihdr(4, 4)) + _chunk(b"IDAT", idat)
            + _chunk(b"tEXt", b"k\x00v") + _chunk(b"IDAT", idat) + _chunk(b"IEND", b""))
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_png(data)


def test_validate_png_trailing_bytes_refused():
    data = _rgb_png() + b"\x00"
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_png(data)


def test_validate_png_duplicate_iend_refused():
    good = _rgb_png()
    data = good + _chunk(b"IEND", b"")
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_png(data)


def test_validate_png_apng_actl_refused():
    idat = zlib.compress(b"\x00" * 64)
    data = (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", _ihdr(4, 4)) + _chunk(b"acTL", b"\x00" * 8)
            + _chunk(b"IDAT", idat) + _chunk(b"IEND", b""))
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_png(data)


def test_validate_png_unknown_critical_chunk_refused():
    idat = zlib.compress(b"\x00" * 64)
    data = (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", _ihdr(4, 4)) + _chunk(b"XHDR", b"\x00\x00\x00\x00")
            + _chunk(b"IDAT", idat) + _chunk(b"IEND", b""))
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_png(data)


def test_validate_png_permitted_ancillary_chunk_succeeds():
    idat = zlib.compress(b"\x00" * 64)
    data = (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", _ihdr(4, 4)) + _chunk(b"tEXt", b"k\x00v")
            + _chunk(b"IDAT", idat) + _chunk(b"IEND", b""))
    assert adapter._validate_png(data) == (4, 4)


def test_validate_png_reserved_bit_refused():
    idat = zlib.compress(b"\x00" * 64)
    data = (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHdr", _ihdr(4, 4)) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b""))
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_png(data)


def test_validate_png_pixel_bound_equal_cap_ok_exceed_refused():
    w = h = 4000  # exactly 16,000,000 == _MAX_PNG_PIXELS
    assert w * h == adapter._MAX_PNG_PIXELS
    idat = zlib.compress(b"\x00" * 64)
    ok = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", _ihdr(w, h)) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")
    assert adapter._validate_png(ok) == (w, h)
    bad = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", _ihdr(w, h + 1)) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_png(bad)


# ---------------------------------------------------------------------------
# parse_config_json
# ---------------------------------------------------------------------------

def test_parse_config_json_accepts_plain_object():
    assert adapter.parse_config_json('{"a": 1}') == {"a": 1}


def test_parse_config_json_rejects_duplicate_keys():
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter.parse_config_json('{"a": 1, "a": 2}')


def test_parse_config_json_rejects_nonfinite_numbers():
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter.parse_config_json('{"a": NaN}')
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter.parse_config_json('{"a": Infinity}')


def test_parse_config_json_rejects_malformed_json():
    with pytest.raises(json.JSONDecodeError):
        adapter.parse_config_json("{not json")


def test_parse_config_json_rejects_non_dict_root():
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter.parse_config_json("[1, 2, 3]")
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter.parse_config_json('"hello"')


def test_parse_config_json_rejects_oversize_utf8():
    huge = json.dumps({"pad": "x" * (adapter.MAX_CONFIG_BYTES + 10)})
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter.parse_config_json(huge)


def test_parse_config_json_rejects_non_string_input():
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter.parse_config_json(123)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# _validate_config
# ---------------------------------------------------------------------------

def _valid_plan_id() -> str:
    return "00000000-0000-4000-8000-000000000000"


def _base_config(repo=r"C:\synthrepo"):
    plan_id = _valid_plan_id()
    return {
        "schema": adapter.CONFIG_SCHEMA, "operation": adapter.OPERATION,
        "creator": adapter.CREATOR, "stage": adapter.STAGE,
        "python_executable": sys.executable,
        "repo_root": repo,
        "plan_root": repo + "\\plans\\" + plan_id,
        "persona_root": repo + "\\orgs\\figment\\personas\\creator-001",
        "pipeline_root": repo + "\\orgs\\figment\\pipeline",
        "store_root": repo + "\\store",
        "plan_id": plan_id,
        "plan_sha256": "0" * 64,
        "marker_sha256": "1" * 64,
        "adapter_sha256": "2" * 64,
        "dependency_sha256": {name: "3" * 64 for name in adapter.DEPENDENCY_NAMES},
    }


def test_validate_config_accepts_well_formed_shape():
    cfg = adapter._validate_config(_base_config())
    assert cfg["plan_id"] == _valid_plan_id()
    assert "_paths" in cfg


def test_validate_config_rejects_extra_or_missing_key():
    cfg = _base_config()
    cfg["unexpected"] = "x"
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_config(cfg)
    cfg = _base_config()
    del cfg["stage"]
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_config(cfg)


def test_validate_config_rejects_wrong_type():
    cfg = _base_config()
    cfg["plan_id"] = 12345
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_config(cfg)


def test_validate_config_rejects_bad_uuid():
    cfg = _base_config()
    cfg["plan_id"] = "not-a-uuid"
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_config(cfg)


def test_validate_config_rejects_bad_pins():
    cfg = _base_config()
    cfg["adapter_sha256"] = "zz" * 32
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_config(cfg)
    cfg = _base_config()
    del cfg["dependency_sha256"]["persona.py"]
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_config(cfg)
    cfg = _base_config()
    cfg["dependency_sha256"]["unexpected.py"] = "4" * 64
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_config(cfg)


def test_validate_config_rejects_plan_root_name_mismatch():
    cfg = _base_config()
    cfg["plan_root"] = cfg["plan_root"].rsplit("\\", 1)[0] + "\\different-name"
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_config(cfg)


def test_validate_config_rejects_wrong_pipeline_root_relation():
    cfg = _base_config()
    cfg["pipeline_root"] = cfg["repo_root"] + "\\other\\pipeline"
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_config(cfg)


def test_validate_config_rejects_nondisjoint_data_roots():
    cfg = _base_config()
    cfg["persona_root"] = cfg["plan_root"] + "\\nested"
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_config(cfg)


def test_validate_config_rejects_store_overlap_with_data_root():
    cfg = _base_config()
    cfg["store_root"] = cfg["plan_root"]
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_config(cfg)


def test_validate_config_rejects_wrong_python_executable():
    cfg = _base_config()
    cfg["python_executable"] = r"C:\Other\python.exe"
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_config(cfg)


def test_validate_config_rejects_root_outside_repo():
    cfg = _base_config()
    cfg["store_root"] = r"D:\elsewhere\store"
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_config(cfg)


# ---------------------------------------------------------------------------
# One-shot main()/emit contract
# ---------------------------------------------------------------------------

def test_main_second_invocation_never_emits(monkeypatch):
    module = _fresh_adapter_module()

    class _Boom:
        def flush(self):
            pass

        @property
        def buffer(self):
            raise RuntimeError("boom on first attempt")

    monkeypatch.setattr(sys, "stdout", _Boom())
    first = module.main(["--unknown", "x"])
    assert first == 1

    class _Buf:
        def __init__(self, sink):
            self._sink = sink

        def write(self, data):
            self._sink.append(data)
            return len(data)

        def flush(self):
            pass

    class _Good:
        def __init__(self):
            self.chunks = []

        def flush(self):
            pass

        @property
        def buffer(self):
            return _Buf(self.chunks)

    good = _Good()
    monkeypatch.setattr(sys, "stdout", good)
    second = module.main(["--unknown", "x"])
    assert second == 1
    assert good.chunks == []  # a prior failed emission must never be retried


def test_observe_open_is_one_shot():
    module = _fresh_adapter_module()
    with pytest.raises(module.StillReviewAdapterError):
        module.observe_open({})  # exact invalid config, with no filesystem access
    with pytest.raises(module.StillReviewAdapterError, match="one-shot"):
        module.observe_open({})


# ---------------------------------------------------------------------------
# Real fresh-process CLI: argument-shape and config-layer failures.
# These reach only argv parsing / parse_config_json / _validate_config, so
# no dependency closure needs to exist on disk for them to fail correctly.
# ---------------------------------------------------------------------------

def _run_process(argv, timeout=120):
    allowed = {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE",
               "HOMEPATH", "PATH", "APPDATA", "LOCALAPPDATA", "COMSPEC", "PROGRAMDATA",
               "PROGRAMFILES", "PROGRAMFILES(X86)", "COMMONPROGRAMFILES",
               "COMMONPROGRAMFILES(X86)", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "OS", "PATHEXT"}
    env = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    # File-backed streams prevent capture_output from accumulating arbitrary data
    # in memory. Size is checked after exit, not a live disk quota; these fixed
    # trusted children emit bounded product records. The outer verification Job
    # owns every fresh child/descendant and enforces the total time limit.
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                                 env=env, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            code = child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            child.kill(); child.wait(timeout=5)
            raise
        assert out.tell() <= adapter.MAX_ENVELOPE_BYTES
        assert err.tell() <= 16384
        out.seek(0); err.seek(0)
        return subprocess.CompletedProcess(argv, code, out.read(adapter.MAX_ENVELOPE_BYTES + 1), err.read(16385))


def _run_cli(args, timeout=120, *, adapter_path=ADAPTER_REAL):
    return _run_process([sys.executable, "-I", "-B", str(adapter_path), *args], timeout)


def _run_env(env):
    return _run_cli(["--config-json", json.dumps(env["config"])],
                    adapter_path=env["pipeline_root"] / "still_review_adapter.py")


def _observe_error(env):
    # Separate fresh child, same real source/reader/authority. It exposes only
    # the thrown error for a targeted boundary assertion; no function is patched.
    code = """import importlib.util,json,sys
p=sys.argv[1]
s=importlib.util.spec_from_file_location('open_boundary_probe',p)
m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)
try:
 m.observe_open(json.loads(sys.argv[2]))
except Exception as exc:
 error={'type':type(exc).__name__,'message':str(exc)}
 if exc.__cause__ is not None: error['cause']=str(exc.__cause__)
 print(json.dumps(error));sys.exit(0)
raise AssertionError('expected observation refusal')
"""
    result = _run_process([sys.executable, "-I", "-B", "-c", code,
                           str(env["pipeline_root"] / "still_review_adapter.py"), json.dumps(env["config"])])
    assert result.returncode == 0, result.stderr
    assert result.stderr == b""
    return json.loads(result.stdout)


@pytest.mark.parametrize("args", [
    [],
    ["--help"],
    ["--config-json"],
    ["--config-json", "{}", "extra"],
    ["--config-json", "{}", "--config-json", "{}"],
    ["--unknown", "{}"],
])
def test_cli_argument_shape_failures_produce_fixed_error(args):
    result = _run_cli(args)
    assert result.returncode == 1
    assert result.stdout == _fixed_error_bytes()
    assert result.stderr == b""


@pytest.mark.parametrize("config_json", [
    '{"a": 1, "a": 2}',
    '{"a": NaN}',
    "{not json",
    "[1, 2, 3]",
    json.dumps({"pad": "x" * (adapter.MAX_CONFIG_BYTES + 5)}),
    json.dumps({**_base_config(), "plan_id": "not-a-uuid"}),
    json.dumps({**_base_config(), "adapter_sha256": "zz" * 32}),
])
def test_cli_config_layer_failures_produce_fixed_error(config_json):
    result = _run_cli(["--config-json", config_json])
    assert result.returncode == 1
    assert result.stdout == _fixed_error_bytes()
    assert result.stderr == b""


# ---------------------------------------------------------------------------
# Bootstrap: source pin corruption over fresh copied module files.
# ---------------------------------------------------------------------------

def _sha256_file(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _copy_closure(pipeline_root: Path) -> None:
    pipeline_root.mkdir(parents=True, exist_ok=True)
    for name in ("still_review_adapter.py", *adapter.DEPENDENCY_NAMES, "gate.yaml", "gates.py"):
        src = PIPELINE / name
        assert src.is_file(), f"expected real source file missing: {src}"
        shutil.copy2(src, pipeline_root / name)


def test_bootstrap_rejects_corrupted_source_pin(tmp_path):
    env = _build_environment(tmp_path)
    target = env["pipeline_root"] / "persona.py"
    data = bytearray(target.read_bytes()); data[-1] ^= 1
    target.write_bytes(data)
    result = _run_env(env)
    assert result.returncode == 1 and result.stdout == _fixed_error_bytes() and result.stderr == b""
    assert _observe_error(env)["message"] == "source pin mismatch"


# ---------------------------------------------------------------------------
# Full synthetic happy-path fixture: real bootstrap, real _load_plan /
# _current_review_subject / lineage.assert_current, real finalize_admission.
# ---------------------------------------------------------------------------

def _write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True), encoding="utf-8")


def _build_environment(tmp_path, *, real_evaluation=True, grading_rows=None,
                        repeat_anchor=True, repeat_reference=False, stale_evaluation=False,
                        drop_evaluation=False, duplicate_spelling=None, long_ids=False):
    repo_root = tmp_path / "r"
    pipeline_root = repo_root / "orgs" / "figment" / "pipeline"
    _copy_closure(pipeline_root)

    # Sibling of pipeline_root under orgs/figment so the persona's register
    # spec ("../../pipeline/look-spec.md") lands inside our real pipeline_root.
    personas_container = repo_root / "orgs" / "figment" / "personas"
    personas_container.mkdir(parents=True)
    with producers._OfflineGuard():
        persona_path = producers._make_synthetic_persona(personas_container)
    persona_root = persona_path.parent

    if repeat_reference:
        doc = json.loads(persona_path.read_text(encoding="utf-8"))
        doc["identity"]["references"].append(doc["identity"]["references"][0])
        persona_path.write_text(json.dumps(doc, ensure_ascii=False, sort_keys=True), encoding="utf-8")

    plan_id = str(uuid.uuid4())
    plan_root = repo_root / "plans" / plan_id
    plan_root.mkdir(parents=True)
    store_root = repo_root / "store"
    store_root.mkdir(parents=True)

    anchors_dir = plan_root / "anchors"
    anchors_dir.mkdir(parents=True)
    (anchors_dir / "a1.png").write_bytes(_rgb_png(4, 4, (11, 22, 33)))
    anchor_rel = ["anchors/a1.png"]
    if repeat_anchor:
        anchor_rel.append("anchors/a1.png")

    grade_dir = plan_root / "grade" / "gen"
    images_dir = plan_root / "images"
    images_dir.mkdir(parents=True)
    img1 = images_dir / "img1.png"
    img2 = images_dir / "img2.png"
    img1.write_bytes(_rgb_png(5, 5, (10, 20, 30)))
    img2.write_bytes(_rgb_png(6, 6, (40, 50, 60)))
    anchor_rel.append("images/img1.png")  # valid graded/anchor reuse

    if grading_rows is None:
        grading_rows = [
            {"image_id": "id1", "path": str(img1)},
            {"image_id": "id2", "path": str(img2)},
        ]
    if duplicate_spelling is not None:
        grading_rows = _duplicate_rows(img1, duplicate_spelling)
    if long_ids:
        grading_rows = [{**row, "image_id": row["image_id"] + "x" * 25000} for row in grading_rows]
    grading = {"creator": "creator-001", "stage": "gen", "images": grading_rows}
    _write_json(grade_dir / "grading-manifest.json", grading)

    gate = {"schema": "figment/gate@1", "rows": [{"image_id": row["image_id"]} for row in grading_rows]}
    _write_json(grade_dir / "gate.json", gate)
    _write_json(grade_dir / "manifest.json", {"note": "synthetic gen manifest"})

    persona_dir_rel = "orgs/figment/personas/" + persona_root.name
    plan = {
        "schema": "figment/train-plan@1", "creator": "creator-001",
        "stages": {"gen": {"runs": [{"manifest": "grade/gen/manifest.json"}]}},
        "assets": {"anchors": anchor_rel, "persona_dir": persona_dir_rel},
    }
    plan_path = plan_root / "plan.json"
    _write_json(plan_path, plan)
    plan_sha256 = _sha256_file(plan_path)

    now = datetime.now(timezone.utc)
    created_utc = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
    marker = {
        "schema": "figment/studio-gen-plan-marker@1", "id": plan_id,
        "plan_sha256": plan_sha256, "intent_sha256": "a" * 64, "created_utc": created_utc,
    }
    marker_path = plan_root / "published.json"
    _write_json(marker_path, marker)
    marker_sha256 = _sha256_file(marker_path)

    evaluation_path = grade_dir / "evaluation-inputs.json"
    if not drop_evaluation:
        if real_evaluation:
            tag = uuid.uuid4().hex
            driver = producers.load_module(f"fixture_figment_train_{tag}", pipeline_root / "figment_train.py")
            lineage_mod = producers.load_module(f"fixture_lineage_{tag}", pipeline_root / "lineage.py")
            with producers._OfflineGuard():
                loaded_plan, root = driver._load_plan("creator-001", plan_path, reads=None)
                subject = driver._current_review_subject(loaded_plan, root, "gen", grading, reads=None)
            evaluation = lineage_mod.wrap_subject(lineage_mod.EVALUATION_SCHEMA, subject)
            if stale_evaluation:
                evaluation["subject_sha256"] = "f" * 64
        else:
            evaluation = {"schema": "figment/evaluation-inputs@1", "subject": {}, "subject_sha256": "0" * 64}
        _write_json(evaluation_path, evaluation)

    dependency_sha256 = {name: _sha256_file(pipeline_root / name) for name in adapter.DEPENDENCY_NAMES}
    config = {
        "schema": adapter.CONFIG_SCHEMA, "operation": adapter.OPERATION,
        "creator": adapter.CREATOR, "stage": adapter.STAGE,
        "python_executable": sys.executable, "repo_root": str(repo_root),
        "plan_root": str(plan_root), "persona_root": str(persona_root),
        "pipeline_root": str(pipeline_root), "store_root": str(store_root),
        "plan_id": plan_id, "plan_sha256": plan_sha256, "marker_sha256": marker_sha256,
        "adapter_sha256": _sha256_file(pipeline_root / "still_review_adapter.py"),
        "dependency_sha256": dependency_sha256,
    }
    return {
        "config": config, "pipeline_root": pipeline_root, "plan_root": plan_root,
        "persona_root": persona_root,
        "originals": {
            "adapter": _sha256_file(pipeline_root / "still_review_adapter.py"),
            "deps": dict(dependency_sha256),
        },
    }


def test_cli_real_happy_open_with_repeated_anchor_and_cross_role(tmp_path):
    env = _build_environment(tmp_path, repeat_anchor=True, repeat_reference=False)
    before_deps = dict(env["originals"]["deps"])
    before_adapter = env["originals"]["adapter"]

    result = _run_env(env)
    assert result.stderr == b""
    assert result.returncode == 0, result.stdout
    assert result.stdout.endswith(b"\n")
    assert len(result.stdout) <= adapter.MAX_ENVELOPE_BYTES

    envelope = json.loads(result.stdout.decode("ascii"))
    assert envelope["schema"] == adapter.SUCCESS_SCHEMA
    assert envelope["operation"] == "open"
    assert envelope["creator"] == "creator-001"
    assert envelope["stage"] == "gen"
    assert envelope["plan_id"] == env["config"]["plan_id"]
    assert envelope["plan_sha256"] == env["config"]["plan_sha256"]
    assert isinstance(envelope["subject"], dict)
    assert envelope["subject_sha256"] == adapter._canonical_sha256(envelope["subject"])
    assert len(envelope["graded"]) == 2
    assert {row["image_id"] for row in envelope["graded"]} == {"id1", "id2"}
    assert len(envelope["reference"]) == 6  # 3 anchors (including repeated/cross-role) plus 3 unique persona references
    for row in envelope["graded"] + envelope["reference"]:
        assert isinstance(row["sha256"], str) and len(row["sha256"]) == 64
        assert row["width"] > 0 and row["height"] > 0
    assert isinstance(envelope["asset_paths"], dict)
    assert isinstance(envelope["common_config_sha256"], str)
    assert isinstance(envelope["subject_binding_sha256"], str)
    assert isinstance(envelope["baseline"], str)
    assert envelope["baseline_bytes"] == len(envelope["baseline"].encode("ascii"))
    assert hashlib.sha256(envelope["baseline"].encode("ascii")).hexdigest() == envelope["baseline_sha256"]

    # No writes: source files/pins are unchanged, and no C finals/tmp appear.
    for name, sha in before_deps.items():
        assert _sha256_file(env["pipeline_root"] / name) == sha
    assert _sha256_file(env["pipeline_root"] / "still_review_adapter.py") == before_adapter
    grade_dir = env["plan_root"] / "grade" / "gen"
    for final in (*adapter._ALL_FINALS, adapter._NEGATIVE_PROBE):
        assert not (grade_dir / final).exists()
        assert not (grade_dir / (final + ".tmp")).exists()


def test_cli_stale_evaluation_fails_with_fixed_output(tmp_path):
    env = _build_environment(tmp_path, stale_evaluation=True)
    result = _run_env(env)
    assert result.returncode == 1
    assert result.stdout == _fixed_error_bytes()
    assert result.stderr == b""


def test_cli_missing_evaluation_fails_with_fixed_output(tmp_path):
    env = _build_environment(tmp_path, drop_evaluation=True)
    result = _run_env(env)
    assert result.returncode == 1
    assert result.stdout == _fixed_error_bytes()
    assert result.stderr == b""


# ---------------------------------------------------------------------------
# Duplicate normalized-PNG regression: two different graded ids must never
# name the same physical file, including exact/case/slash spellings.
# ---------------------------------------------------------------------------

def _duplicate_rows(img1: Path, spelling: str):
    base = str(img1)
    if spelling == "exact":
        second = base
    elif spelling == "case":
        second = base.replace("img1", "IMG1")
        drive, rest = second[:1], second[1:]
        second = drive.upper() + rest
    elif spelling == "slash":
        second = base.replace("\\", "/", 2)  # forward slashes on a leading segment
    else:  # pragma: no cover - guard against typos in test authoring
        raise AssertionError(spelling)
    return [
        {"image_id": "id1", "path": base},
        {"image_id": "id2", "path": second},
    ]


@pytest.mark.parametrize("spelling", ["exact", "case", "slash"])
def test_cli_rejects_duplicate_normalized_graded_png(tmp_path, spelling):
    # Real legacy subject/evaluation is consistent even for duplicate physical
    # paths. Thus the exact adapter boundary, not stale evidence, must refuse.
    env = _build_environment(tmp_path, duplicate_spelling=spelling)
    result = _run_env(env)
    assert result.returncode == 1
    assert result.stdout == _fixed_error_bytes() and result.stderr == b""
    error = _observe_error(env)
    assert error == {"type": "StillReviewAdapterError", "message": "graded PNG paths must be distinct"}


# ---------------------------------------------------------------------------
# Canonical bytes / sha256 pure helpers
# ---------------------------------------------------------------------------

def test_canonical_bytes_is_sorted_ascii_and_stable():
    a = adapter._canonical_bytes({"b": 1, "a": 2})
    b = adapter._canonical_bytes({"a": 2, "b": 1})
    assert a == b
    assert a == b'{"a":2,"b":1}'


def test_canonical_sha256_matches_hashlib_of_canonical_bytes():
    value = {"z": [1, 2, 3], "a": "x"}
    assert adapter._canonical_sha256(value) == hashlib.sha256(adapter._canonical_bytes(value)).hexdigest()


def test_canonical_bytes_rejects_nan():
    with pytest.raises(ValueError):
        adapter._canonical_bytes({"a": float("nan")})


# ---------------------------------------------------------------------------
# _drive_absolute / _join_relative
# ---------------------------------------------------------------------------

def test_drive_absolute_rejects_relative_and_forward_slash():
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._drive_absolute("relative\\path", "field")
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._drive_absolute("C:/uses/forward/slash", "field")


def test_drive_absolute_rejects_dot_segments_and_reserved_names():
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._drive_absolute(r"C:\a\..\b", "field")
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._drive_absolute(r"C:\CON\file", "field")


def test_drive_absolute_accepts_well_formed_path():
    path = adapter._drive_absolute(r"C:\a\b\c", "field")
    assert str(path) == r"C:\a\b\c"


def test_join_relative_rejects_absolute_and_excess_traversal():
    root = adapter._drive_absolute(r"C:\root", "root")
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._join_relative(root, r"C:\other\abs.png", (root,))
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._join_relative(root, "../../../too/far.png", (root,), persona=True)


def test_join_relative_rejects_traversal_outside_permitted_roots():
    root = adapter._drive_absolute(r"C:\root", "root")
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._join_relative(root, "sub/file.png", (adapter._drive_absolute(r"C:\other", "o"),))


def test_join_relative_accepts_simple_relative_path():
    root = adapter._drive_absolute(r"C:\root", "root")
    path, dirs = adapter._join_relative(root, "sub/file.png", (root,))
    assert str(path) == r"C:\root\sub\file.png"
    assert dirs == (root,)


def test_join_relative_persona_allows_bounded_parent_traversal():
    root = adapter._drive_absolute(r"C:\a\b\personas\creator-001", "root")
    pipeline = adapter._drive_absolute(r"C:\a\b\pipeline", "pipeline")
    path, _ = adapter._join_relative(root, "../../pipeline/look-spec.md", (root, pipeline), persona=True)
    assert str(path) == r"C:\a\b\pipeline\look-spec.md"


# ---------------------------------------------------------------------------
# Domain-shape validators (pure, no filesystem)
# ---------------------------------------------------------------------------

def test_validate_grading_rejects_duplicate_image_ids():
    grading = {
        "creator": "creator-001", "stage": "gen",
        "images": [{"image_id": "x", "path": "a.png"}, {"image_id": "x", "path": "b.png"}],
    }
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_grading(grading)


def test_validate_grading_accepts_well_formed_rows():
    grading = {
        "creator": "creator-001", "stage": "gen",
        "images": [{"image_id": "a", "path": "a.png"}, {"image_id": "b", "path": "b.PNG"}],
    }
    images = adapter._validate_grading(grading)
    assert [row["image_id"] for row in images] == ["a", "b"]


def test_validate_gate_requires_exact_coverage():
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_gate({"schema": "figment/gate@1", "rows": [{"image_id": "a"}]}, ["a", "b"])
    adapter._validate_gate({"schema": "figment/gate@1", "rows": [{"image_id": "a"}, {"image_id": "b"}]}, ["a", "b"])


def test_validate_gate_rejects_duplicate_rows():
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_gate(
            {"schema": "figment/gate@1", "rows": [{"image_id": "a"}, {"image_id": "a"}]}, ["a"],
        )


def test_validate_marker_rejects_bad_shape_and_timestamp():
    good_id, good_plan_sha = _valid_plan_id(), "0" * 64
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_marker({"schema": "wrong"}, {"plan_id": good_id, "plan_sha256": good_plan_sha})
    marker = {
        "schema": "figment/studio-gen-plan-marker@1", "id": good_id, "plan_sha256": good_plan_sha,
        "intent_sha256": "a" * 64, "created_utc": "2024-01-01T00:00:00Z",  # missing milliseconds
    }
    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_marker(marker, {"plan_id": good_id, "plan_sha256": good_plan_sha})


def test_validate_evaluation_requires_exact_schema():
    class _Lin:
        EVALUATION_SCHEMA = "figment/evaluation-inputs@1"

    with pytest.raises(adapter.StillReviewAdapterError):
        adapter._validate_evaluation({"schema": "wrong"}, _Lin())
    adapter._validate_evaluation({"schema": "figment/evaluation-inputs@1"}, _Lin())


# Native additions cover the missing bounded-admission and binding contracts.
# All media here is local synthetic bytes; no source cap is monkeypatched.

def _refresh_plan_marker(env):
    plan = env["plan_root"] / "plan.json"
    marker = env["plan_root"] / "published.json"
    env["config"]["plan_sha256"] = _sha256_file(plan)
    value = json.loads(marker.read_text())
    value["plan_sha256"] = env["config"]["plan_sha256"]
    _write_json(marker, value)
    env["config"]["marker_sha256"] = _sha256_file(marker)


def test_occurrence_weighted_image_budget_precedes_authority(tmp_path):
    env = _build_environment(tmp_path, real_evaluation=False)
    grade = env["plan_root"] / "grade" / "gen"
    # 24 MiB unique bytes, but the repeated 12 MiB anchor makes M > 32 MiB.
    (env["plan_root"] / "images" / "img1.png").write_bytes(b"x" * (12 * 1024 * 1024))
    (env["plan_root"] / "anchors" / "a1.png").write_bytes(b"y" * (12 * 1024 * 1024))
    assert adapter._MAX_M_BYTES == 32 * 1024 * 1024
    error = _observe_error(env)
    assert error["message"] == "domain image/text budget exceeded", error


def test_actual_text_budget_precedes_authority(tmp_path):
    env = _build_environment(tmp_path, real_evaluation=False)
    grade = env["plan_root"] / "grade" / "gen"
    for path in (env["pipeline_root"] / "gate.yaml", env["pipeline_root"] / "look-spec.md",
                 env["persona_root"] / "identity-spec.md"):
        path.write_bytes(b"s" * (1024 * 1024))
    for path in (env["plan_root"] / "plan.json", env["persona_root"] / "persona.yaml",
                 grade / "grading-manifest.json", grade / "gate.json", grade / "manifest.json"):
        value = json.loads(path.read_text()); value["padding"] = "x" * (240 * 1024)
        _write_json(path, value)
        assert path.stat().st_size <= 256 * 1024
    _refresh_plan_marker(env)
    assert adapter._MAX_J_BYTES == 4 * 1024 * 1024
    error = _observe_error(env)
    assert error["message"] == "domain image/text budget exceeded", error


def test_actual_whole_escaped_envelope_cap(tmp_path):
    env = _build_environment(tmp_path, long_ids=True)
    assert _observe_error(env)["message"] == "whole escaped result exceeds cap"


def _projection_fixture():
    # Constructed wire projection unit data only: this does not claim reader
    # admission or filesystem observation. The happy CLI covers real export.
    cfg = adapter._validate_config(_base_config())
    path = cfg["_paths"]["plan_root"] / "plan.json"
    key = adapter._norm(path)
    roots = (*reversed(path.parent.parents), path.parent)
    fp = {field: str(index + 2**54) for index, field in enumerate(
        ("device", "inode", "size", "modified", "changed", "birthtime", "mode", "attributes"))}
    baseline = {"phase": "P", "policy": {"limits": {"max_stream_bytes": 2 * 1024**3},
        "members": {key: {"max_bytes": 262144, "allow_json": True, "optional": False}}, "branch": "keep",
        "comparison": {adapter._norm(p): "strict" if p == path.parent else "identity" for p in roots}},
        "directories": {adapter._norm(p): dict(fp) for p in roots},
        "files": {key: {"named": dict(fp), "opened": dict(fp), "digest": "a" * 64}},
        "originals": {}, "counters": {"operations": 0, "unique_bytes": 0, "stream_bytes": 0}}
    return cfg, baseline, {key: SimpleNamespace(path=path)}, {key: {"plan"}}, key


def test_subject_projection_identity_strict_digest_absence_and_common_caps():
    cfg, baseline, members, roles, key = _projection_fixture()
    bind = lambda c, b: adapter._subject_binding(c, b, members, roles, (), "b" * 64)
    original = bind(cfg, baseline)
    identity = next(k for k, mode in baseline["policy"]["comparison"].items() if mode == "identity")
    strict = next(k for k, mode in baseline["policy"]["comparison"].items() if mode == "strict")
    changed = deepcopy(baseline)
    changed["directories"][identity]["modified"] = "999"
    changed["directories"][identity]["changed"] = "999"
    assert bind(cfg, changed) == original
    for directory, field in ((identity, "inode"), (strict, "modified")):
        changed = deepcopy(baseline); changed["directories"][directory][field] = "999"
        assert bind(cfg, changed)[1] != original[1]
    changed = deepcopy(baseline); changed["files"][key]["digest"] = "c" * 64
    assert bind(cfg, changed)[1] != original[1]
    changed = deepcopy(baseline); changed["files"][key] = None
    assert bind(cfg, changed)[1] != original[1]
    changed = deepcopy(baseline); changed["policy"]["limits"]["max_stream_bytes"] -= 1
    assert bind(cfg, changed)[0] != original[0]
    different = deepcopy(cfg); different["adapter_sha256"] = "d" * 64
    assert bind(different, baseline)[0] != original[0]
    different = deepcopy(cfg); different["_paths"]["store_root"] /= "another"
    changed = deepcopy(baseline); changed["policy"]["branch"] = "cull"; changed["counters"]["stream_bytes"] = 99
    assert bind(different, changed) == original


def test_duplicate_persona_references_preserve_existing_authority(tmp_path):
    env = _build_environment(tmp_path, real_evaluation=False, repeat_reference=True)
    error = _observe_error(env)
    assert "duplicate reference" in error["message"], error


@pytest.mark.parametrize("failure", ["write", "short_write", "buffer_flush", "stream_flush"])
def test_main_output_failures_never_emit_twice(monkeypatch, failure):
    module = _fresh_adapter_module()
    writes = []
    class Buffer:
        def write(self, data):
            writes.append(data)
            if failure == "write": raise OSError("write failed")
            return len(data) - 1 if failure == "short_write" else len(data)
        def flush(self):
            if failure == "buffer_flush": raise OSError("flush failed")
    class Stream:
        buffer = Buffer()
        def flush(self):
            if failure == "stream_flush": raise OSError("flush failed")
    with monkeypatch.context() as scoped:
        scoped.setattr(sys, "stdout", Stream())
        assert module.main(["--help"]) == 1
        assert module.main(["--help"]) == 1
    assert len(writes) == (0 if failure == "stream_flush" else 1)
    if writes: assert writes == [_fixed_error_bytes()]
