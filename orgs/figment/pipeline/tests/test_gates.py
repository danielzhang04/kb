import hashlib
import importlib.util
import sys
from pathlib import Path

PIPELINE = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gates = load_module("figment_pipeline_gates_under_test", PIPELINE / "gates.py")


# ---------------------------------------------------------------------------
# sha256_file -- the one thing this module still does. E4 deleted
# write_gate/gate_is_current (a second, dead, incompatible gate.json schema with zero
# non-test callers); the pipeline's real gate.json writer is
# identity_gate.write_gate_document, covered by test_identity_gate.py and
# test_figment_train.py.
# ---------------------------------------------------------------------------


def test_sha256_file_matches_hashlib(tmp_path):
    path = tmp_path / "x.txt"
    path.write_bytes(b"hello world")
    assert gates.sha256_file(path) == hashlib.sha256(b"hello world").hexdigest()


def test_sha256_file_streams_without_loading_whole_file(tmp_path):
    # A regression guard for the "never loads the whole file into memory at once"
    # docstring claim: a multi-chunk file still hashes correctly.
    path = tmp_path / "y.bin"
    payload = b"a" * (gates._READ_CHUNK * 3 + 17)
    path.write_bytes(payload)
    assert gates.sha256_file(path) == hashlib.sha256(payload).hexdigest()


def test_write_gate_and_gate_is_current_no_longer_exist():
    # E4: the dead SHA-bound human-decision schema was deleted, not kept alongside
    # the real figment/gate@1 writer.
    assert not hasattr(gates, "write_gate")
    assert not hasattr(gates, "gate_is_current")
