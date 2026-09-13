"""Boundary and regression tests for ``pipeline/gen_source_read.py``.

These tests have not been executed as part of writing them.

Scope
-----
* CLI contract tests start real Windows CPython children with ``sys.executable -I -B``.
  Each test captures raw stdout and stderr bytes under a timeout, then checks three
  things: exit 1, the exact unavailable line ending in LF, and empty stderr. No ``.pyc``
  file may appear in the observed trees.
* Bootstrap tests copy the exact reader bytes into a temporary
  ``orgs/figment/pipeline`` directory beside small *synthetic* dependency sources. Each
  synthetic source carries a marker tripwire. These tests exercise only the adapter's
  isolation guards. They do **not** prove real domain authority, real observed-read
  behaviour, or any full-domain outcome. A separate authority fixture covers that.
* Output-boundary probes replace only ``observe_gen_source`` inside an isolated
  harness child. They check line encoding and the write/flush failure handling. They
  are **not** success-path validator tests.
* Nothing here deletes module-cache entries, patches subprocess globally, or touches
  network, providers or real media.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import textwrap
from types import SimpleNamespace

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
READER = PIPELINE / "gen_source_read.py"
SCHEMA = "figment/gen-source-read@1"
UNAVAILABLE_LINE = b'{"result":"unavailable","schema":"figment/gen-source-read@1"}\n'
TIMEOUT_SECONDS = 60
PINS_FLAG = "--dependency-sha256"

DEPENDENCIES = (
    ("observed_reads.py", "_figment_gen_source_observed_reads"),
    ("persona.py", "_figment_training_config_persona"),
    ("lineage.py", "_figment_train_lineage"),
    ("training_config.py", "_figment_train_training_config"),
    ("figment_train.py", "_figment_gen_source_figment_train"),
)
DEP_NAMES = tuple(name for name, _ in DEPENDENCIES)
DEP_ALIASES = [alias for _, alias in DEPENDENCIES]
FAKE_PINS = {name: "c" * 64 for name in DEP_NAMES}

pytestmark = pytest.mark.skipif(
    sys.platform != "win32" or platform.python_implementation() != "CPython",
    reason="gen_source_read CLI contract is defined for Windows CPython children",
)

_COUNTER = itertools.count()


@pytest.fixture(autouse=True, scope="module")
def _reader_present():
    assert READER.is_file(), f"reader under test missing: {READER}"


# ---------------------------------------------------------------------------
# Child process helpers
# ---------------------------------------------------------------------------

def _child_env() -> dict:
    return {k: v for k, v in os.environ.items() if not k.upper().startswith("PYTHON")}


def _child(interpreter_flags, script: Path, args, cwd: Path) -> subprocess.CompletedProcess:
    command = [sys.executable, *interpreter_flags, str(script), *map(str, args)]
    try:
        return subprocess.run(
            command, cwd=str(cwd), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=TIMEOUT_SECONDS, env=_child_env(), check=False,
        )
    except subprocess.TimeoutExpired as exc:
        pytest.fail(f"child timed out after {TIMEOUT_SECONDS}s: stdout={exc.stdout!r} stderr={exc.stderr!r}")


def _assert_unavailable(proc: subprocess.CompletedProcess) -> None:
    assert proc.returncode == 1, (proc.returncode, proc.stdout, proc.stderr)
    assert proc.stdout == UNAVAILABLE_LINE
    assert proc.stderr == b""


def _pyc_files(*roots: Path) -> set:
    found: set = set()
    for root in roots:
        if root.is_dir():
            found.update(root.rglob("*.pyc"))
    return found


def _values(root: Path, pins_text: str) -> dict:
    return {
        "--creator": "creator-001",
        "--selected-root": str(root / "selected"),
        "--selected-plan-sha256": "a" * 64,
        "--source-root": str(root / "source"),
        "--source-plan-sha256": "b" * 64,
        PINS_FLAG: pins_text,
    }


def _flatten(values: dict) -> list:
    return [item for pair in values.items() for item in pair]


def _pins_text(pins: dict) -> str:
    return json.dumps(pins, separators=(",", ":"))


# ---------------------------------------------------------------------------
# Synthetic copied tree (isolation guards only; no domain authority)
# ---------------------------------------------------------------------------

_TC_BODY = (
    "import sys\n\n"
    "def _load_persona_module():\n"
    "    return sys.modules['_figment_training_config_persona']\n"
)
_FT_BODY = (
    "import sys\nROOT = None\nHERE = None\n\n"
    "def _training_config_module():\n"
    "{inject}"
    "    return sys.modules['_figment_train_training_config']\n\n"
    "def _lineage_module():\n"
    "    return sys.modules['_figment_train_lineage']\n"
)
PIPELINE_INJECTION = (
    "import os, sys, types\n"
    "_probe = types.ModuleType('_unpinned_pipeline_probe')\n"
    "_probe.__file__ = os.path.join(os.path.dirname(__file__), 'unpinned_probe.py')\n"
    "sys.modules['_unpinned_pipeline_probe'] = _probe\n"
)
FORBIDDEN_ALIAS_INJECTION = (
    "import sys, types\n"
    "sys.modules['_figment_train_qa_stamp'] = types.ModuleType('_figment_train_qa_stamp')\n"
)
RUNTIME_FAILURE = "raise RuntimeError('synthetic dependency failure')\n"


@pytest.fixture
def synth(tmp_path):
    base = tmp_path.resolve()
    pipe = base / "orgs" / "figment" / "pipeline"
    pipe.mkdir(parents=True)
    reader = pipe / "gen_source_read.py"
    reader.write_bytes(READER.read_bytes())
    markers = base / "markers"
    markers.mkdir()
    return SimpleNamespace(base=base, pipe=pipe, reader=reader, markers=markers)


def _write_synthetic(s, extras: dict | None = None, ft_inject: str = "") -> dict:
    """Write bounded synthetic dependencies whose first statement drops a marker."""
    extras = extras or {}
    bodies = {
        "observed_reads.py": "", "persona.py": "", "lineage.py": "",
        "training_config.py": _TC_BODY,
        "figment_train.py": _FT_BODY.format(inject=textwrap.indent(ft_inject, "    ")),
    }
    pins = {}
    for name in DEP_NAMES:
        marker = str(s.markers / (name + ".ran"))
        source = f"open({marker!r}, 'x').close()\n" + extras.get(name, "") + bodies[name]
        data = source.encode("utf-8")
        (s.pipe / name).write_bytes(data)
        pins[name] = hashlib.sha256(data).hexdigest()
    return pins


def _markers(s) -> list:
    return sorted(p.name[: -len(".ran")] for p in s.markers.glob("*.ran"))


def _clear_markers(s) -> None:
    for marker in s.markers.glob("*.ran"):
        marker.unlink()


# ---------------------------------------------------------------------------
# Static harness: compiles the exact copied reader bytes under -I -B, preserving
# __file__ and sys.modules identity. It writes its report to a file, never stdout.
# ---------------------------------------------------------------------------

HARNESS = r'''
import hashlib
import json
import os
import sys
import types

with open(sys.argv[1], encoding="utf-8") as handle:
    SPEC = json.load(handle)
READER_PATH = SPEC["reader"]
NAME = "gen_source_read_under_test"
with open(READER_PATH, "rb") as handle:
    RAW = handle.read()
mod = types.ModuleType(NAME)
mod.__file__ = READER_PATH
mod.__loader__ = None
sys.modules[NAME] = mod
exec(compile(RAW, READER_PATH, "exec", dont_inherit=True), mod.__dict__)
report = {
    "reader_sha256": hashlib.sha256(RAW).hexdigest(),
    "identity_preserved": sys.modules.get(NAME) is mod and mod.__file__ == READER_PATH,
}


def cause_of(call):
    try:
        call()
    except mod.GenSourceUnavailable as exc:
        cause = exc.__cause__
        return [type(cause).__name__, str(cause)]
    except BaseException as exc:
        return ["escaped:" + type(exc).__name__, str(exc)]
    return ["returned", ""]


class FakeBuffer:
    def __init__(self, mode):
        self.mode, self.writes, self.flushes = mode, [], 0

    def write(self, data):
        self.writes.append(bytes(data))
        if self.mode == "write_raises":
            raise OSError("synthetic write failure")
        if self.mode == "short_write":
            return len(data) - 1
        if self.mode == "none_write":
            return None
        return len(data)

    def flush(self):
        self.flushes += 1
        if self.mode == "flush_raises":
            raise OSError("synthetic flush failure")


class FakeStream:
    def __init__(self, buffer):
        self.buffer = buffer

    def flush(self):
        pass


class FakeObs:
    class ReadMember:
        pass

    class ObservedReads:
        def __init__(self, **kwargs):
            raise RuntimeError("synthetic reader construction failure")

    @staticmethod
    def _lexical(path):
        return path

    @staticmethod
    def _key(path):
        return str(path).lower()

    @staticmethod
    def _within(path, root):
        return False


def run(probe):
    argv = SPEC.get("argv")
    if probe == "observe":
        planted = {}
        for alias in SPEC.get("preplant", ()):
            planted[alias] = sys.modules[alias] = types.ModuleType(alias)
        foreign = None
        if SPEC.get("foreign"):
            foreign = types.ModuleType("_foreign_pipeline_module")
            foreign.__file__ = os.path.join(os.path.dirname(READER_PATH), "foreign_module.py")
            sys.modules["_foreign_pipeline_module"] = foreign
        report["first"] = cause_of(lambda: mod.observe_gen_source(mod._parse_argv(argv)))
        report["second"] = cause_of(lambda: mod.observe_gen_source(mod._parse_argv(argv)))
        report["planted_kept"] = all(sys.modules.get(a) is m for a, m in planted.items())
        report["foreign_kept"] = foreign is None or sys.modules.get("_foreign_pipeline_module") is foreign
        report["aliases_present"] = [alias for _, alias in mod._DEPENDENCIES if alias in sys.modules]
        return 0
    if probe == "router_poison":
        router = mod._Router(FakeObs)
        try:
            router.admit((), (), (), None)
            report["admit"] = "returned"
        except RuntimeError:
            report["admit"] = "raised"
        for label, call in (("sha256", lambda: router.sha256("C:\\x\\y.json")),
                            ("recheck", router.recheck)):
            try:
                call()
                report[label] = "returned"
            except BaseException as exc:
                report[label] = str(exc)
        return 0
    summary = SPEC["summary"]
    mod.observe_gen_source = lambda config: summary  # Output-boundary probe only.
    if probe == "out_real":
        return mod.main(argv)
    if probe == "out_broken_pipe":
        read_end, write_end = os.pipe()
        os.close(read_end)
        os.dup2(write_end, 1)
        os.close(write_end)
        rc = mod.main(argv)
        report["stdout_is_none"] = sys.stdout is None
        return rc
    buffer = FakeBuffer(SPEC["mode"])
    real = sys.stdout
    sys.stdout = FakeStream(buffer)
    try:
        rc = mod.main(argv)
        report["stdout_is_none"] = sys.stdout is None
    finally:
        sys.stdout = real
    report["writes"] = [item.decode("latin-1") for item in buffer.writes]
    report["flushes"] = buffer.flushes
    return rc


try:
    report["rc"] = run(SPEC["probe"])
except BaseException as exc:
    report["rc"] = 99
    report["harness_error"] = type(exc).__name__ + ": " + str(exc)
with open(SPEC["report"], "w", encoding="utf-8") as handle:
    json.dump(report, handle)
os._exit(report["rc"])
'''


def _harness(s, probe: str, **spec):
    harness = s.base / "harness.py"
    if not harness.exists():
        harness.write_text(HARNESS, encoding="utf-8")
    index = next(_COUNTER)
    report_path = s.base / f"report-{index}.json"
    spec_path = s.base / f"spec-{index}.json"
    spec_path.write_text(json.dumps({
        "reader": str(s.reader), "probe": probe, "report": str(report_path), **spec,
    }), encoding="utf-8")
    before = _pyc_files(PIPELINE / "__pycache__", s.base)
    proc = _child(["-I", "-B"], harness, [spec_path], cwd=s.base)
    assert _pyc_files(PIPELINE / "__pycache__", s.base) - before == set()
    assert proc.stderr == b"", proc.stderr
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert "harness_error" not in report, report
    assert report["identity_preserved"] is True
    assert report["reader_sha256"] == hashlib.sha256(READER.read_bytes()).hexdigest()
    return proc, report


def _synthetic_argv(s, pins: dict) -> list:
    return _flatten(_values(s.base, _pins_text(pins)))


# ---------------------------------------------------------------------------
# CLI argument contract (real reader file; refusals precede any dependency execution,
# and fake pins would mismatch before execution in any case)
# ---------------------------------------------------------------------------

def _set(flag, value):
    return lambda v: _flatten({**v, flag: value})


_MISSING_KEY = {k: v for k, v in FAKE_PINS.items() if k != "lineage.py"}
_DUPLICATE_KEY_TEXT = (
    '{"observed_reads.py":"' + "c" * 64 + '",'
    + ",".join(f'"{name}":"{"c" * 64}"' for name in DEP_NAMES) + "}"
)
_NAN_TEXT = '{"observed_reads.py":NaN,' + ",".join(
    f'"{name}":"{"c" * 64}"' for name in DEP_NAMES[1:]) + "}"

ARGV_CASES = [
    ("no-arguments", lambda v: []),
    ("missing-pair", lambda v: _flatten(v)[:-2]),
    ("extra-pair", lambda v: _flatten(v) + ["--creator", "creator-001"]),
    ("unknown-flag", lambda v: ["--persona" if a == "--creator" else a for a in _flatten(v)]),
    ("duplicate-flag", lambda v: ["--selected-root" if a == "--source-root" else a for a in _flatten(v)]),
    ("equals-form", lambda v: ["--creator=creator-001", "creator-001", *_flatten(v)[2:]]),
    ("value-before-flag", lambda v: [_flatten(v)[1], _flatten(v)[0], *_flatten(v)[2:]]),
    ("invalid-creator-case", _set("--creator", "Creator-001")),
    ("invalid-creator-hyphen", _set("--creator", "creator-")),
    ("relative-root", _set("--selected-root", "selected")),
    ("parent-traversal-root", lambda v: _flatten({**v, "--source-root": v["--source-root"] + "\\..\\escape"})),
    ("uppercase-plan-digest", _set("--selected-plan-sha256", "A" * 64)),
    ("pins-missing-key", _set(PINS_FLAG, _pins_text(_MISSING_KEY))),
    ("pins-extra-key", _set(PINS_FLAG, _pins_text({**FAKE_PINS, "gate.py": "c" * 64}))),
    ("pins-uppercase-digest", _set(PINS_FLAG, _pins_text({**FAKE_PINS, "persona.py": "C" * 64}))),
    ("pins-not-object", _set(PINS_FLAG, "[]")),
    ("pins-nan-constant", _set(PINS_FLAG, _NAN_TEXT)),
    ("pins-duplicate-json-key", _set(PINS_FLAG, _DUPLICATE_KEY_TEXT)),
    ("pins-not-json", _set(PINS_FLAG, "{")),
]


@pytest.mark.parametrize("mutate", [case[1] for case in ARGV_CASES], ids=[case[0] for case in ARGV_CASES])
def test_cli_argument_refusal_emits_only_fixed_unavailable_line(tmp_path, mutate):
    root = tmp_path.resolve()
    before = _pyc_files(PIPELINE / "__pycache__", root)
    proc = _child(["-I", "-B"], READER, mutate(_values(root, _pins_text(FAKE_PINS))), cwd=root)
    _assert_unavailable(proc)
    assert _pyc_files(PIPELINE / "__pycache__", root) - before == set()


def test_duplicate_key_fixture_really_duplicates_a_key():
    assert _DUPLICATE_KEY_TEXT.count('"observed_reads.py"') == 2
    assert set(json.loads(_DUPLICATE_KEY_TEXT)) == set(DEP_NAMES)  # Stdlib json would accept it.


@pytest.mark.parametrize("flags", [["-B"], ["-I"], []], ids=["missing-I", "missing-B", "neither"])
def test_cli_refuses_without_isolated_and_no_bytecode_before_bootstrap(synth, flags):
    pins = _write_synthetic(synth)  # Correct pins: only the runtime-flag guard can stop it.
    before = _pyc_files(PIPELINE / "__pycache__", synth.base)
    proc = _child(flags, synth.reader, _synthetic_argv(synth, pins), cwd=synth.base)
    _assert_unavailable(proc)
    assert _markers(synth) == []
    assert _pyc_files(PIPELINE / "__pycache__", synth.base) - before == set()


# ---------------------------------------------------------------------------
# Bootstrap isolation guards (synthetic dependencies; NOT domain authority)
# ---------------------------------------------------------------------------

def test_synthetic_tripwires_fire_when_pins_match(synth):
    """Sensitivity control showing that the marker tripwires and the harness can see execution.

    With matching pins, all five synthetic sources run. The later refusal is an
    AttributeError, because the synthetic ``observed_reads`` has no reader API. That
    refusal proves nothing about the real domain chain.
    """
    pins = _write_synthetic(synth)
    proc, report = _harness(synth, "observe", argv=_synthetic_argv(synth, pins))
    assert proc.returncode == 0 and proc.stdout == b""
    assert _markers(synth) == sorted(DEP_NAMES)
    assert report["first"][0] == "AttributeError" and "_key" in report["first"][1]
    assert report["second"] == ["_Refusal", "one-shot adapter already used"]
    assert report["aliases_present"] == DEP_ALIASES


@pytest.mark.parametrize("tampered", ["observed_reads.py", "figment_train.py"])
def test_dependency_pin_mismatch_refuses_before_any_dependency_executes(synth, tampered):
    pins = _write_synthetic(synth)
    path = synth.pipe / tampered
    path.write_bytes(path.read_bytes() + b"# changed after pinning\n")
    before = _pyc_files(PIPELINE / "__pycache__", synth.base)
    proc = _child(["-I", "-B"], synth.reader, _synthetic_argv(synth, pins), cwd=synth.base)
    _assert_unavailable(proc)
    assert _markers(synth) == []  # Even the last-verified file's mismatch precedes all execution.
    assert _pyc_files(PIPELINE / "__pycache__", synth.base) - before == set()

    _, report = _harness(synth, "observe", argv=_synthetic_argv(synth, pins))
    assert report["first"] == ["_Refusal", "dependency pin mismatch"]
    assert report["aliases_present"] == []
    assert _markers(synth) == []


@pytest.mark.parametrize("alias, reason", [
    ("_figment_train_lineage", "preplanted dependency alias"),
    ("_figment_train_render_config", "preplanted project alias"),
])
def test_preplanted_alias_refuses_without_execution_or_cache_deletion(synth, alias, reason):
    pins = _write_synthetic(synth)
    proc, report = _harness(synth, "observe", argv=_synthetic_argv(synth, pins), preplant=[alias])
    assert proc.stdout == b""
    assert report["first"] == ["_Refusal", reason]
    assert report["planted_kept"] is True
    assert report["aliases_present"] == ([alias] if alias in DEP_ALIASES else [])
    assert _markers(synth) == []


def test_arbitrary_pipeline_module_in_baseline_refuses_and_is_left_in_place(synth):
    pins = _write_synthetic(synth)
    _, report = _harness(synth, "observe", argv=_synthetic_argv(synth, pins), foreign=True)
    assert report["first"] == ["_Refusal", "preexisting project module is not this adapter"]
    assert report["foreign_kept"] is True
    assert report["aliases_present"] == []
    assert _markers(synth) == []


@pytest.mark.parametrize("injection, reason", [
    (PIPELINE_INJECTION, "unexpected project module set"),
    (FORBIDDEN_ALIAS_INJECTION, "unpinned project module executed during bootstrap"),
], ids=["pipeline-located-module", "forbidden-loader-alias"])
def test_unexpected_module_during_bootstrap_refuses_output(synth, injection, reason):
    """The bootstrap cannot prevent execution. It can only refuse output (synthetic guard test)."""
    pins = _write_synthetic(synth, extras={"lineage.py": injection})
    proc = _child(["-I", "-B"], synth.reader, _synthetic_argv(synth, pins), cwd=synth.base)
    _assert_unavailable(proc)
    assert _markers(synth) == sorted(DEP_NAMES)

    _clear_markers(synth)
    _, report = _harness(synth, "observe", argv=_synthetic_argv(synth, pins))
    assert report["first"] == ["_Refusal", reason]
    assert report["second"] == ["_Refusal", "one-shot adapter already used"]


def test_unexpected_module_during_post_bootstrap_dependency_call_refuses(synth):
    """The injection happens inside the first adapter call into dependency code.

    Here that call is ``_training_config_module``. Compare the clean control above,
    which refuses later with AttributeError. This covers only the exact-set recheck
    after a dependency call. Injection during the real ``_load_plan`` or
    ``_validate_gen_source_inputs`` seams needs the separate authority fixture.
    """
    pins = _write_synthetic(synth, ft_inject=PIPELINE_INJECTION)
    proc = _child(["-I", "-B"], synth.reader, _synthetic_argv(synth, pins), cwd=synth.base)
    _assert_unavailable(proc)

    _clear_markers(synth)
    _, report = _harness(synth, "observe", argv=_synthetic_argv(synth, pins))
    assert report["first"] == ["_Refusal", "unexpected project module set"]


def test_dependency_runtime_error_is_fixed_refusal_and_poisons_one_shot(synth):
    pins = _write_synthetic(synth, extras={"training_config.py": RUNTIME_FAILURE})
    proc = _child(["-I", "-B"], synth.reader, _synthetic_argv(synth, pins), cwd=synth.base)
    _assert_unavailable(proc)  # Empty stderr: no traceback leaks.
    executed = ["lineage.py", "observed_reads.py", "persona.py", "training_config.py"]
    assert _markers(synth) == executed

    _clear_markers(synth)
    _, report = _harness(synth, "observe", argv=_synthetic_argv(synth, pins))
    assert report["first"] == ["RuntimeError", "synthetic dependency failure"]
    assert report["second"] == ["_Refusal", "one-shot adapter already used"]
    assert report["aliases_present"] == DEP_ALIASES[:4]  # Left in place: one-shot poison.
    assert _markers(synth) == executed


def test_router_construction_failure_poisons_later_operations(synth):
    proc, report = _harness(synth, "router_poison")
    assert proc.returncode == 0 and proc.stdout == b""
    assert report["admit"] == "raised"
    assert report["sha256"] == "router poisoned or sealed"
    assert report["recheck"] == "router poisoned or sealed"


# ---------------------------------------------------------------------------
# Output boundary (observe_gen_source replaced; NOT a success-path validator test)
# ---------------------------------------------------------------------------

OUTPUT_SUMMARY = {
    "schema": SCHEMA,
    "result": "current-source-observed",
    "creator": "creator-001",
    "gen_manifest_sha256": ["d" * 64],
    "gen_runs": 1,
    "note": "caf\u00e9",
    "claims": {"launch_ready": False, "quality_approved": False, "atomic_snapshot": False},
}
EXPECTED_LINE = (json.dumps(OUTPUT_SUMMARY, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")
OVERSIZED_SUMMARY = {"pad": "x" * 5000}


def _output_argv(s) -> list:
    return _flatten(_values(s.base, _pins_text(FAKE_PINS)))


def test_output_boundary_writes_exact_binary_lf_line(synth):
    proc, report = _harness(synth, "out_real", argv=_output_argv(synth), summary=OUTPUT_SUMMARY)
    assert proc.returncode == 0 and report["rc"] == 0
    assert proc.stdout == EXPECTED_LINE
    assert b"\r" not in proc.stdout and proc.stdout.count(b"\n") == 1
    assert b"\\u00e9" in proc.stdout
    assert _markers(synth) == []


def test_output_boundary_oversized_summary_emits_only_unavailable(synth):
    proc, report = _harness(synth, "out_real", argv=_output_argv(synth), summary=OVERSIZED_SUMMARY)
    assert report["rc"] == 1
    _assert_unavailable(proc)


@pytest.mark.parametrize("mode, summary, expected", [
    ("write_raises", OUTPUT_SUMMARY, EXPECTED_LINE),
    ("flush_raises", OUTPUT_SUMMARY, EXPECTED_LINE),
    ("short_write", OUTPUT_SUMMARY, EXPECTED_LINE),
    ("write_raises", OVERSIZED_SUMMARY, UNAVAILABLE_LINE),
], ids=["success-write-raises", "success-flush-raises", "success-short-write", "unavailable-write-raises"])
def test_output_boundary_failure_is_exit1_single_attempt_and_silenced(synth, mode, summary, expected):
    proc, report = _harness(synth, "out_fake", argv=_output_argv(synth), summary=summary, mode=mode)
    assert proc.returncode == 1 and report["rc"] == 1
    assert proc.stdout == b""
    assert report["writes"] == [expected.decode("latin-1")]  # Never a second (unavailable) line.
    assert report["stdout_is_none"] is True


def test_output_boundary_broken_real_stdout_terminates_via_os_exit(synth):
    """Scoped to the harness's direct call into ``mod.main``.

    A real fd-level broken pipe must give exit 1 and no 'Exception ignored' noise.
    ``main`` returns control to the harness, and it is the harness that then
    calls ``os._exit``, terminating before normal Python interpreter
    finalization ever runs; the absence of shutdown noise here is credited to
    that harness-level termination, not to main itself reaching os._exit or to
    a quiet finalization sequence. This calls ``main`` inside the harness
    process, not the reader's own ``os._exit`` entry point; see the sibling
    CLI-entry test below for that.
    """
    proc, report = _harness(synth, "out_broken_pipe", argv=_output_argv(synth), summary=OUTPUT_SUMMARY)
    assert proc.returncode == 1 and report["rc"] == 1
    assert proc.stdout == b""
    assert proc.stderr == b""
    assert report["stdout_is_none"] is True


CLI_BROKEN_PIPE_WRAPPER = r'''
import os
import sys
import types

READER_PATH = sys.argv[1]
read_end, write_end = os.pipe()
os.close(read_end)
os.dup2(write_end, 1)
os.close(write_end)
sys.argv = [READER_PATH, "--creator", "not valid"]
main_module = types.ModuleType("__main__")
main_module.__file__ = READER_PATH
sys.modules["__main__"] = main_module
with open(READER_PATH, "rb") as handle:
    raw = handle.read()
exec(compile(raw, READER_PATH, "exec", dont_inherit=True), main_module.__dict__)
os._exit(99)
'''


def test_cli_entry_broken_real_stdout_terminates_via_os_exit(synth):
    """Covers the reader's actual ``__main__``/``os._exit`` entry point, not ``main()`` alone.

    Invalid argv refuses before any dependency executes, so this stays a pure
    output/termination-contract probe, not an authority or success-path test.
    """
    wrapper = synth.base / "cli_broken_pipe_wrapper.py"
    wrapper.write_text(CLI_BROKEN_PIPE_WRAPPER, encoding="utf-8")
    before = _pyc_files(PIPELINE / "__pycache__", synth.base)
    proc = _child(["-I", "-B"], wrapper, [str(synth.reader)], cwd=synth.base)
    assert proc.returncode == 1
    assert proc.stdout == b""
    assert proc.stderr == b""
    assert _pyc_files(PIPELINE / "__pycache__", synth.base) - before == set()


def test_output_boundary_write_returning_none_is_not_reported_as_success(synth):
    """Regression contract: a None write result must never be treated as success.

    On a raw non-blocking binary stream, ``write`` returning None means no bytes were
    written. An earlier revision had a gap where ``_emit`` accepted ``written is None``
    as success; that gap has since been repaired, and this test guards against its
    reintroduction by asserting exit 1 and no reported stdout stream survival.
    """
    proc, report = _harness(synth, "out_fake", argv=_output_argv(synth), summary=OUTPUT_SUMMARY,
                            mode="none_write")
    assert report["writes"] == [EXPECTED_LINE.decode("latin-1")]
    assert proc.returncode == 1 and report["rc"] == 1
    assert report["stdout_is_none"] is True
