"""Read-only StillReview 'open' adapter: first bounded observation join.

This module performs no writes and no legacy dispatch. Given one bounded
``--config-json`` control string, it (1) verifies a fixed seven-file plus
self source closure by exact byte hash, (2) constructs one
``StillReviewReads`` router under a deferred-admission policy, (3) admits a
finite, schema-checked set A of control/plan/persona/grade documents, (4)
derives a finite, occurrence-bounded set B of graded PNGs, plan anchors and
current persona identity references, (5) seals admission and calls the real
plan loader / review-subject builder / lineage freshness assertion, (6)
performs bounded, in-memory static PNG structural validation over every
admitted physical image (with occurrence-weighted accounting), and (7) emits exactly one bounded ASCII JSON
line: a private ``figment/still-review-open@1`` observation, or on any
failure a single fixed, traceback-free error record.

No approval, ruling, launch, or write action is implied or produced here.
"""
from __future__ import annotations

import hashlib
import ctypes
from datetime import datetime, timezone
import importlib.machinery
import itertools
import json
import ntpath
import os
import re
import stat
import struct
import sys
import types
import zlib
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Fixed shape constants
# ---------------------------------------------------------------------------

CONFIG_SCHEMA = "figment/still-review-open-config@1"
SUCCESS_SCHEMA = "figment/still-review-open@1"
ERROR_SCHEMA = "figment/still-review-open-error@1"
CREATOR = "creator-001"
OPERATION = "open"
STAGE = "gen"

MAX_CONFIG_BYTES = 16 * 1024
MAX_ENVELOPE_BYTES = 131072

DEPENDENCY_NAMES = (
    "observed_reads.py",
    "still_review_reads.py",
    "persona.py",
    "training_config.py",
    "lineage.py",
    "qa_stamp.py",
    "figment_train.py",
)

_ALIAS_PACKAGE = "_figment_still_review_bootstrap"
_ALIASES = {
    "observed_reads.py": f"{_ALIAS_PACKAGE}.observed_reads",
    "still_review_reads.py": f"{_ALIAS_PACKAGE}.still_review_reads",
    "persona.py": "_figment_training_config_persona",
    "training_config.py": "_figment_train_training_config",
    "lineage.py": "_figment_train_lineage",
    "qa_stamp.py": "_figment_train_qa_stamp",
    "figment_train.py": "_figment_still_review_figment_train",
}
_FORBIDDEN_PRECHECK = frozenset((*_ALIASES.values(), _ALIAS_PACKAGE))

_SHA_RE = re.compile(r"[0-9a-f]{64}\Z")
_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z")
_ISO_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\Z")
_MAX_FILE_BYTES = 512 * 1024
_MAX_PNG_BYTES = 16 * 1024 * 1024
_MAX_PNG_PIXELS = 16_000_000
_MAX_ANCHORS = 8
_MAX_PERSONA_REFS = 8
_MAX_IMAGES = 16
_MAX_M_BYTES = 32 * 1024 * 1024
_MAX_J_BYTES = 4 * 1024 * 1024
_MAX_TEXT_BYTES = 1024 * 1024
_MAX_JSON_BYTES = 256 * 1024
_IDENTITY_FIELDS = ("device", "inode", "birthtime", "mode", "attributes")
_RESERVED_COMPONENT = re.compile(r"(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9???]|LPT[1-9???])(?:\..*)?\Z", re.I)

CONFIG_PATH_KEYS = (
    "python_executable", "repo_root", "plan_root", "persona_root",
    "pipeline_root", "store_root",
)
CONFIG_KEYS = frozenset((
    "schema", "operation", "creator", "stage", *CONFIG_PATH_KEYS,
    "plan_id", "plan_sha256", "marker_sha256", "adapter_sha256",
    "dependency_sha256",
))

_KEEP_FINALS = ("rulings.json", "review-manifest.json", "approved-list.json", "approval-lineage.json")
_ALL_FINALS = ("rulings.json", "review-manifest.json", "approved-list.json",
               "approval-lineage.json", "rejection-lineage.json")
_NEGATIVE_PROBE = "accepted-checkpoint.json"

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_PNG_CRITICAL = frozenset(("IHDR", "PLTE", "IDAT", "IEND"))
_PNG_FORBIDDEN = frozenset(("acTL", "fcTL", "fdAT"))
_PNG_ALLOWED_COLOR_BITDEPTH = {
    0: (1, 2, 4, 8, 16),
    2: (8, 16),
    3: (1, 2, 4, 8),
    4: (8, 16),
    6: (8, 16),
}


class StillReviewAdapterError(ValueError):
    """A finite, traceback-free refusal of this one-shot open observation."""


def _refuse(message: str) -> None:
    raise StillReviewAdapterError(message)


# ---------------------------------------------------------------------------
# Canonical JSON helpers
# ---------------------------------------------------------------------------

def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode("ascii")


def _canonical_sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _dup_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _refuse("duplicate JSON key")
        result[key] = value
    return result


def _no_constant(_token):
    _refuse("nonfinite JSON number")


# ---------------------------------------------------------------------------
# Path normalization helpers (adapter-local; no filesystem I/O)
# ---------------------------------------------------------------------------

def _norm(path: Path) -> str:
    return ntpath.normcase(str(path)).rstrip("\\")


def _contains(root: Path, other: Path) -> bool:
    r, o = _norm(root), _norm(other)
    return o == r or o.startswith(r + "\\")


def _drive_absolute(value: Any, field: str) -> Path:
    if type(value) is not str or not value or len(value) > 260 or "/" in value:
        _refuse(f"{field} must be a bounded canonical Windows path")
    if not re.fullmatch(r"[A-Za-z]:\\.+", value):
        _refuse(f"{field} must be drive absolute")
    parts = value.split("\\")[1:]
    if len(parts) > 64:
        _refuse("path depth exceeds policy")
    for part in parts:
        if (not part or part in (".", "..") or part.endswith((".", " "))
                or _RESERVED_COMPONENT.fullmatch(part)
                or any(ord(c) < 32 or c in ':<>"|?*' for c in part)):
            _refuse("unsupported path component")
    return Path(value)



# ---------------------------------------------------------------------------
# Configuration validation
# ---------------------------------------------------------------------------

def _validate_config(config: dict) -> dict:
    if type(config) is not dict or set(config) != CONFIG_KEYS:
        _refuse("config keys do not match the fixed schema")
    if config["schema"] != CONFIG_SCHEMA:
        _refuse("unsupported config schema")
    if config["operation"] != OPERATION:
        _refuse("unsupported operation")
    if config["creator"] != CREATOR:
        _refuse("unsupported creator")
    if config["stage"] != STAGE:
        _refuse("unsupported stage")
    paths = {key: _drive_absolute(config[key], key) for key in CONFIG_PATH_KEYS}
    if not isinstance(config["plan_id"], str) or not _UUID_RE.fullmatch(config["plan_id"]):
        _refuse("plan_id must be a canonical lowercase UUID")
    for key in ("plan_sha256", "marker_sha256", "adapter_sha256"):
        if not isinstance(config[key], str) or not _SHA_RE.fullmatch(config[key]):
            _refuse(f"{key} must be a lowercase sha256 hex digest")
    deps = config["dependency_sha256"]
    if type(deps) is not dict or set(deps) != set(DEPENDENCY_NAMES):
        _refuse("dependency_sha256 must contain exactly the seven fixed names")
    for name, digest in deps.items():
        if not isinstance(digest, str) or not _SHA_RE.fullmatch(digest):
            _refuse(f"dependency_sha256[{name}] must be a lowercase sha256 hex digest")

    repo_root = paths["repo_root"]
    pipeline_root = paths["pipeline_root"]
    plan_root = paths["plan_root"]
    if plan_root.name != config["plan_id"]:
        _refuse("plan_root name must equal the selected plan_id")
    persona_root = paths["persona_root"]
    store_root = paths["store_root"]

    expected_pipeline = repo_root / "orgs" / "figment" / "pipeline"
    if _norm(pipeline_root) != _norm(expected_pipeline):
        _refuse("pipeline_root must equal repo_root/orgs/figment/pipeline")

    for role_root in (plan_root, persona_root, pipeline_root, store_root):
        if not _contains(repo_root, role_root):
            _refuse("every role root must lie within repo_root")

    data_roots = (plan_root, persona_root, pipeline_root)
    for a, b in itertools.combinations(data_roots, 2):
        if _contains(a, b) or _contains(b, a):
            _refuse("plan_root/persona_root/pipeline_root must be pairwise disjoint")
    for root in data_roots:
        if _contains(store_root, root) or _contains(root, store_root):
            _refuse("store_root must be disjoint from every data root")

    executable = paths["python_executable"]
    if _norm(Path(sys.executable)) != _norm(executable):
        _refuse("python_executable does not match the running interpreter")
    if os.name != "nt" or sys.implementation.name != "cpython":
        _refuse("local Windows CPython is required")

    normalized = dict(config)
    normalized["_paths"] = paths
    return normalized


def parse_config_json(raw: str) -> dict:
    if type(raw) is not str or len(raw.encode("utf-8")) > MAX_CONFIG_BYTES:
        _refuse("config JSON exceeds the bounded transport size")
    value = json.loads(raw, object_pairs_hook=_dup_pairs, parse_constant=_no_constant)
    if type(value) is not dict:
        _refuse("config must be an object")
    return value  # Public observe_open owns the one normalization boundary.



# ---------------------------------------------------------------------------
# Exact seven-file plus self source bootstrap
# ---------------------------------------------------------------------------

def _source_fingerprint(info, *, directory=False):
    values = (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
              info.st_ctime_ns, getattr(info, "st_birthtime_ns", None),
              info.st_mode, getattr(info, "st_file_attributes", None))
    if any(type(v) is not int or v < 0 for v in values) or values[1] == 0:
        _refuse("source filesystem identity unavailable")
    if values[7] & 0x400 or stat.S_ISLNK(values[6]):
        _refuse("source reparse component refused")
    if not (stat.S_ISDIR(values[6]) if directory else stat.S_ISREG(values[6])):
        _refuse("source filesystem kind refused")
    return values


def _source_identity(fp):
    return tuple(fp[i] for i in (0, 1, 5, 6, 7))


def _read_dependency_bytes(path: Path, original=None):
    named = _source_fingerprint(os.lstat(path))
    if not 0 < named[2] <= _MAX_FILE_BYTES:
        _refuse("source byte cap exceeded")
    if original is not None and named != original[0]:
        _refuse("original source named identity changed")
    with path.open("rb", buffering=0) as handle:
        opened = _source_fingerprint(os.fstat(handle.fileno()))
        if any(named[i] != opened[i] for i in (0, 1, 2, 3, 5, 6, 7)):
            _refuse("named/opened source identity differs")
        if original is not None and opened != original[1]:
            _refuse("original source opened identity changed")
        chunks, remaining = [], named[2]
        while remaining:
            block = handle.read(min(65536, remaining))
            if not block:
                _refuse("short source read")
            chunks.append(block)
            remaining -= len(block)
        if (_source_fingerprint(os.fstat(handle.fileno())) != opened
                or _source_fingerprint(os.lstat(path)) != named):
            _refuse("source changed during read")
    raw = b"".join(chunks)
    digest = hashlib.sha256(raw).hexdigest()
    if original is not None and digest != original[2]:
        _refuse("original source digest changed")
    return raw, (named, opened, digest)



def _compile_child(alias: str, path: Path, data: bytes, *, package: str | None):
    module = types.ModuleType(alias)
    module.__file__, module.__loader__, module.__package__ = str(path), None, package or ""
    module.__spec__ = importlib.machinery.ModuleSpec(alias, loader=None, origin=str(path))
    sys.modules[alias] = module
    exec(compile(data, str(path), "exec", dont_inherit=True), module.__dict__)
    return module



class _Bootstrap:
    """Fixed source bytes and original code identities, checked again after work."""
    def __init__(self, cfg):
        self.cfg, self.paths = cfg, cfg["_paths"]
        self.pipeline, self.repo = self.paths["pipeline_root"], self.paths["repo_root"]
        self.self_module = sys.modules.get(__name__)
        self.self_spec = getattr(self.self_module, "__spec__", None)
        self.self_origin = getattr(self.self_spec, "origin", None)
        self.adapter_path = _drive_absolute(str(Path(__file__).absolute()), "adapter")
        if _norm(self.adapter_path) != _norm(self.pipeline / "still_review_adapter.py"):
            _refuse("adapter is not the configured fixed sibling")
        if any(alias in sys.modules for alias in _FORBIDDEN_PRECHECK):
            _refuse("preplanted bootstrap alias")
        if self._project_modules() != {__name__: self.self_module}:
            _refuse("preloaded project module")
        drive_type = ctypes.WinDLL("kernel32", use_last_error=True).GetDriveTypeW
        drive_type.argtypes, drive_type.restype = [ctypes.c_wchar_p], ctypes.c_uint
        for anchor in {p.anchor for p in self.paths.values()}:
            if drive_type(anchor) not in (2, 3, 6):
                _refuse("nonlocal source/config drive")
        self.directories = {}
        for role, path in self.paths.items():
            directory = path.parent if role == "python_executable" else path
            for parent in (*reversed(directory.parents), directory):
                key = _norm(parent)
                if key not in self.directories:
                    if len(self.directories) >= 256:
                        _refuse("bootstrap directory cap")
                    self.directories[key] = (parent, _source_fingerprint(os.lstat(parent), directory=True))
        _source_fingerprint(os.lstat(self.paths["python_executable"]))
        self.records, verified = {}, {}
        for name in ("still_review_adapter.py", *DEPENDENCY_NAMES):
            path = self.pipeline / name
            raw, record = _read_dependency_bytes(path)
            expected = cfg["adapter_sha256"] if name == "still_review_adapter.py" else cfg["dependency_sha256"][name]
            if record[2] != expected:
                _refuse("source pin mismatch")
            self.records[name] = record
            verified[name] = raw
        self._directories_unchanged()
        # Every closure byte is verified before executing the first dependency.
        self.package = types.ModuleType(_ALIAS_PACKAGE)
        self.package.__package__ = _ALIAS_PACKAGE
        self.package.__path__ = []
        self.package.__spec__ = importlib.machinery.ModuleSpec(_ALIAS_PACKAGE, None, is_package=True)
        self.package.__spec__.submodule_search_locations = []
        sys.modules[_ALIAS_PACKAGE] = self.package
        self.modules = {}
        for name in DEPENDENCY_NAMES:
            relative = name in ("observed_reads.py", "still_review_reads.py")
            module = _compile_child(_ALIASES[name], self.pipeline / name, verified[name],
                                    package=_ALIAS_PACKAGE if relative else None)
            self.modules[name[:-3]] = module
            if relative:
                setattr(self.package, name[:-3], module)
        self._identities_unchanged()

    def _locations(self, module):
        result = []
        path = getattr(module, "__file__", None)
        origin = getattr(getattr(module, "__spec__", None), "origin", None)
        for value in (path, origin):
            if isinstance(value, str) and value not in ("built-in", "frozen"):
                result.append(Path(value))
        return result

    def _project_modules(self):
        return {name: module for name, module in tuple(sys.modules.items())
                if any(_contains(self.repo, path) for path in self._locations(module))}

    def _directories_unchanged(self):
        for path, original in self.directories.values():
            current = _source_fingerprint(os.lstat(path), directory=True)
            if (current != original if _contains(self.pipeline, path)
                    else _source_identity(current) != _source_identity(original)):
                _refuse("original source/config directory changed")

    def _identities_unchanged(self):
        if (sys.modules.get(__name__) is not self.self_module
                or _norm(Path(self.self_module.__file__)) != _norm(self.adapter_path)
                or self.self_module.__spec__ is not self.self_spec
                or getattr(self.self_spec, "origin", None) != self.self_origin
                or (self.self_origin is not None and _norm(Path(self.self_origin)) != _norm(self.adapter_path))):
            _refuse("adapter module identity changed")
        if (sys.modules.get(_ALIAS_PACKAGE) is not self.package
                or self.package.__path__ != [] or self.package.__package__ != _ALIAS_PACKAGE
                or self.package.__spec__.name != _ALIAS_PACKAGE
                or self.package.__spec__.submodule_search_locations != []):
            _refuse("synthetic package identity changed")
        expected = {__name__: self.self_module}
        for name in DEPENDENCY_NAMES:
            alias, module, path = _ALIASES[name], self.modules[name[:-3]], self.pipeline / name
            package = _ALIAS_PACKAGE if name in ("observed_reads.py", "still_review_reads.py") else ""
            spec = getattr(module, "__spec__", None)
            if (sys.modules.get(alias) is not module or module.__file__ != str(path)
                    or module.__package__ != package or module.__loader__ is not None
                    or spec is None or spec.name != alias or spec.origin != str(path)
                    or spec.submodule_search_locations is not None):
                _refuse("dependency module identity changed")
            expected[alias] = module
        current = self._project_modules()
        if set(current) != set(expected) or any(current[k] is not v for k, v in expected.items()):
            _refuse("unexpected executed project module closure")
        observed, reader, driver = (self.modules[k] for k in ("observed_reads", "still_review_reads", "figment_train"))
        if (self.package.observed_reads is not observed or self.package.still_review_reads is not reader
                or reader._base is not observed or reader.ReadMember is not observed.ReadMember):
            _refuse("relative reader bootstrap identity changed")
        for module in self.modules.values():
            if hasattr(module, "HERE") and _norm(module.HERE) != _norm(self.pipeline):
                _refuse("dependency HERE differs")
        if _norm(driver.ROOT) != _norm(self.repo):
            _refuse("driver ROOT differs")
        for field, name in (("TRAINING_CONFIG_MODULE", "training_config.py"),
                            ("LINEAGE_MODULE", "lineage.py"), ("QA_MODULE", "qa_stamp.py")):
            if _norm(getattr(driver, field)) != _norm(self.pipeline / name):
                _refuse("driver dependency path differs")

    def finish(self):
        self._directories_unchanged()
        self._identities_unchanged()
        for name, original in self.records.items():
            _read_dependency_bytes(self.pipeline / name, original)
        self._directories_unchanged()
        self._identities_unchanged()



# ---------------------------------------------------------------------------
# Static PNG structural validation (bounded, in-memory, no pixel decode)
# ---------------------------------------------------------------------------

def _validate_png(data: bytes) -> tuple[int, int]:
    if type(data) is not bytes or not 8 <= len(data) <= _MAX_PNG_BYTES or data[:8] != _PNG_SIGNATURE:
        _refuse("PNG signature/size refused")
    pos, width, height, color_type, bit_depth, idat_bytes = 8, 0, 0, None, None, 0
    ihdr = plte = idat_started = idat_ended = iend = False
    while pos < len(data):
        if pos + 12 > len(data):
            _refuse("PNG chunk truncated")
        length = int.from_bytes(data[pos:pos + 4], "big")
        ctype = data[pos + 4:pos + 8]
        end = pos + 12 + length
        if end > len(data) or length > 0x7fffffff:
            _refuse("PNG chunk length refused")
        if (any(not (65 <= b <= 90 or 97 <= b <= 122) for b in ctype)
                or not 65 <= ctype[2] <= 90):
            _refuse("PNG chunk type/reserved bit refused")
        name, payload = ctype.decode("ascii"), data[pos + 8:end - 4]
        if zlib.crc32(data[pos + 4:end - 4]) & 0xffffffff != int.from_bytes(data[end - 4:end], "big"):
            _refuse("PNG CRC refused")
        if name in _PNG_FORBIDDEN or (65 <= ctype[0] <= 90 and name not in _PNG_CRITICAL):
            _refuse("animated/unknown critical PNG chunk refused")
        if not ihdr and name != "IHDR":
            _refuse("PNG first chunk must be IHDR")
        if name == "IHDR":
            if ihdr or length != 13:
                _refuse("PNG IHDR cardinality refused")
            width, height, bit_depth, color_type, compression, filt, interlace = struct.unpack(">IIBBBBB", payload)
            if (not 0 < width <= 0x7fffffff or not 0 < height <= 0x7fffffff
                    or width * height > _MAX_PNG_PIXELS or compression or filt or interlace not in (0, 1)
                    or color_type not in _PNG_ALLOWED_COLOR_BITDEPTH
                    or bit_depth not in _PNG_ALLOWED_COLOR_BITDEPTH[color_type]):
                _refuse("PNG IHDR fields refused")
            ihdr = True
        elif name == "PLTE":
            count = length // 3
            if (plte or idat_started or color_type not in (2, 3, 6) or length % 3
                    or not 1 <= count <= 256 or (color_type == 3 and count > 2 ** bit_depth)):
                _refuse("PNG palette refused")
            plte = True
        elif name == "IDAT":
            if idat_ended or (color_type == 3 and not plte):
                _refuse("PNG IDAT ordering refused")
            idat_started = True
            idat_bytes += length
        elif name == "IEND":
            if length or not idat_started or not idat_bytes:
                _refuse("PNG IEND/IDAT refused")
            iend, pos = True, end
            break
        elif idat_started:
            idat_ended = True
        pos = end
    if not ihdr or not iend or pos != len(data):
        _refuse("PNG required chunks/trailing bytes refused")
    return width, height



# ---------------------------------------------------------------------------
# Staged admission and real join
# ---------------------------------------------------------------------------

def _join_relative(base: Path, value: Any, roots, *, persona=False):
    if type(value) is not str or not value or len(value) > 4096 or ntpath.splitdrive(value)[0] or value.startswith(("/", "\\")):
        _refuse("relative path shape refused")
    parts = value.replace("\\", "/").split("/")
    if len(parts) > 64:
        _refuse("relative path depth refused")
    leading = 0
    while leading < len(parts) and parts[leading] == "..":
        leading += 1
    if leading and (not persona or leading > 2 or leading == len(parts)):
        _refuse("parent traversal refused")
    cursor, directories = base, [base]
    for _ in range(leading):
        if cursor.parent == cursor:
            _refuse("parent traversal exceeds drive")
        cursor = cursor.parent
        directories.append(cursor)
    for part in parts[leading:]:
        if (not part or part in (".", "..") or part.endswith((".", " "))
                or _RESERVED_COMPONENT.fullmatch(part)
                or any(ord(c) < 32 or c in ':<>"|?*' for c in part)):
            _refuse("relative path component refused")
        cursor /= part
    path = _drive_absolute(str(cursor), "derived path")
    if not any(_contains(root, path) and _norm(root) != _norm(path) for root in roots):
        _refuse("derived path outside its role")
    return path, tuple(directories)



def _member(reads_mod, path: Path, *, max_bytes: int, allow_json: bool = False, optional: bool = False):
    return reads_mod.ReadMember(path, max_bytes, allow_json, optional)


def _build_reader(cfg: dict, modules: dict):
    paths, reads = cfg["_paths"], modules["still_review_reads"]
    plan, persona, pipeline, store = (paths[k] for k in ("plan_root", "persona_root", "pipeline_root", "store_root"))
    d = plan / "grade" / "gen"
    a = (plan / "plan.json", plan / "published.json", d / "grading-manifest.json",
         d / "evaluation-inputs.json", d / "gate.json", persona / "persona.yaml", persona / "training.yaml")
    members = [_member(reads, p, max_bytes=_MAX_JSON_BYTES, allow_json=True,
                       optional=p == persona / "training.yaml") for p in a]
    # gate.yaml is threshold text, hashed by legacy lineage, never parsed here.
    members.append(_member(reads, pipeline / "gate.yaml", max_bytes=_MAX_TEXT_BYTES))
    for name in (*_ALL_FINALS, _NEGATIVE_PROBE):
        members.append(_member(reads, d / name, max_bytes=_MAX_JSON_BYTES, allow_json=True, optional=True))
    reader = reads.StillReviewReads(plan_root=plan, persona_root=persona, pipeline_root=pipeline,
        store_root=store, mutation_directory=d, branch="keep", members=tuple(members),
        directories=(), temporary_names=(), phase="P", defer_admission=True)
    return reader, d, tuple(members), tuple((*a, pipeline / "gate.yaml"))



def _validate_marker(marker: Any, cfg: dict) -> None:
    if (type(marker) is not dict or set(marker) != {"schema", "id", "plan_sha256", "intent_sha256", "created_utc"}
            or marker["schema"] != "figment/studio-gen-plan-marker@1"
            or marker["id"] != cfg["plan_id"] or marker["plan_sha256"] != cfg["plan_sha256"]
            or type(marker["intent_sha256"]) is not str or not _SHA_RE.fullmatch(marker["intent_sha256"])):
        _refuse("published marker schema/identity refused")
    value = marker["created_utc"]
    if type(value) is not str or not _ISO_RE.fullmatch(value):
        _refuse("published UTC shape refused")
    parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    if parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z") != value:
        _refuse("published UTC value refused")



def _validate_plan(plan: Any, cfg: dict) -> None:
    if type(plan) is not dict or plan.get("schema") != "figment/train-plan@1" or plan.get("creator") != CREATOR:
        _refuse("plan schema/creator refused")
    stages, assets = plan.get("stages"), plan.get("assets")
    gen = stages.get("gen") if type(stages) is dict else None
    runs = gen.get("runs") if type(gen) is dict else None
    if type(runs) is not list or len(runs) != 1 or type(runs[0]) is not dict or type(runs[0].get("manifest")) is not str:
        _refuse("exact one gen manifest required")
    if type(assets) is not dict or type(assets.get("anchors")) is not list or len(assets["anchors"]) > _MAX_ANCHORS:
        _refuse("plan assets/anchors refused")
    path, _ = _join_relative(cfg["_paths"]["repo_root"], assets.get("persona_dir"), (cfg["_paths"]["repo_root"],))
    if _norm(path) != _norm(cfg["_paths"]["persona_root"]):
        _refuse("plan persona role differs")



def _validate_grading(grading: Any) -> list:
    if type(grading) is not dict or grading.get("creator") != CREATOR or grading.get("stage") != STAGE:
        _refuse("grading manifest creator/stage invalid")
    images = grading.get("images")
    if type(images) is not list or not 1 <= len(images) <= _MAX_IMAGES:
        _refuse("grading manifest image count invalid")
    ids = []
    for row in images:
        if (type(row) is not dict or not isinstance(row.get("image_id"), str) or not row["image_id"]
                or not isinstance(row.get("path"), str) or not row["path"].lower().endswith(".png")):
            _refuse("grading manifest row invalid")
        ids.append(row["image_id"])
    if len(set(ids)) != len(ids):
        _refuse("grading manifest has duplicate image ids")
    return images


def _validate_gate(gate: Any, image_ids: list) -> None:
    if type(gate) is not dict or gate.get("schema") != "figment/gate@1" or type(gate.get("rows")) is not list:
        _refuse("gate evidence schema invalid")
    seen = set()
    for row in gate["rows"]:
        if type(row) is not dict or not isinstance(row.get("image_id"), str):
            _refuse("gate row invalid")
        if row["image_id"] in seen:
            _refuse("gate has duplicate image id")
        seen.add(row["image_id"])
    if seen != set(image_ids):
        _refuse("gate coverage does not match grading manifest exactly")


def _validate_evaluation(evaluation: Any, lineage_mod) -> None:
    if type(evaluation) is not dict or evaluation.get("schema") != lineage_mod.EVALUATION_SCHEMA:
        _refuse("evaluation-inputs schema invalid")


def _common_config(cfg, baseline):
    paths = cfg["_paths"]
    return {
        "schema": "figment/still-review-common-config@1", "creator": CREATOR, "stage": STAGE,
        "python_executable": _norm(paths["python_executable"]), "repo_root": _norm(paths["repo_root"]),
        "data_roots": {role: _norm(paths[role + "_root"]) for role in ("plan", "persona", "pipeline")},
        "plan_id": cfg["plan_id"], "plan_sha256": cfg["plan_sha256"], "marker_sha256": cfg["marker_sha256"],
        "source_pins": {"still_review_adapter.py": cfg["adapter_sha256"], **cfg["dependency_sha256"]},
        "reader_limits": baseline["policy"]["limits"],
        "domain_limits": {"graded": _MAX_IMAGES, "anchors": _MAX_ANCHORS, "persona_references": _MAX_PERSONA_REFS,
            "occurrence_image_bytes": _MAX_M_BYTES, "text_bytes": _MAX_J_BYTES, "png_bytes": _MAX_PNG_BYTES,
            "png_pixels": _MAX_PNG_PIXELS, "json_bytes": _MAX_JSON_BYTES, "text_member_bytes": _MAX_TEXT_BYTES,
            "envelope_bytes": MAX_ENVELOPE_BYTES, "config_bytes": MAX_CONFIG_BYTES, "source_bytes": _MAX_FILE_BYTES},
        "comparison": {"version": 1, "strict_fields": ["device", "inode", "size", "modified", "changed", "birthtime", "mode", "attributes"],
                       "identity_fields": list(_IDENTITY_FIELDS), "disjoint_data_and_store": True},
        "global_finals": sorted((*_ALL_FINALS, _NEGATIVE_PROBE)),
        "global_temps": sorted(name + ".tmp" for name in (*_ALL_FINALS, _NEGATIVE_PROBE)),
    }


def _subject_binding(cfg, baseline, members, roles, directories, subject_sha):
    """Project exported records only; no private reader access or rebased observer."""
    if baseline["phase"] != "P":
        _refuse("open subject requires sealed P observations")
    relevant = {}
    for path in (*[m.path.parent for m in members.values()], *directories):
        for parent in (*reversed(path.parents), path):
            relevant[_norm(parent)] = parent
    directory_records = {}
    for key in baseline["directories"]:
        if _norm(Path(key)) not in relevant:
            continue
        mode, fp = baseline["policy"]["comparison"][key], baseline["directories"][key]
        if mode not in ("strict", "identity"):
            _refuse("unknown directory comparison")
        directory_records[key] = {"comparison": mode,
            "fingerprint": fp if mode == "strict" else {field: fp[field] for field in _IDENTITY_FIELDS}}
    if len(directory_records) != len(relevant):
        _refuse("relevant directory baseline incomplete")
    common = _common_config(cfg, baseline)
    projection = {
        "version": 1, "common_config": common, "subject_sha256": subject_sha,
        "members": {key: {"roles": sorted(roles[key]), "policy": baseline["policy"]["members"][key],
                          "observation": baseline["files"][key]} for key in members},
        "directories": directory_records, "original_grade_entries": baseline["originals"],
    }
    return _canonical_sha256(common), _canonical_sha256(projection)


_OBSERVED = False


def observe_open(config: dict) -> dict:
    global _OBSERVED
    if _OBSERVED:
        _refuse("open observation is one-shot")
    _OBSERVED = True
    cfg = _validate_config(config)
    bootstrap = _Bootstrap(cfg)
    modules, paths = bootstrap.modules, cfg["_paths"]
    reads, lineage, driver = (modules[k] for k in ("still_review_reads", "lineage", "figment_train"))
    reader, d, initial, a_paths = _build_reader(cfg, modules)
    plan_root, persona_root, pipeline_root = (paths[k + "_root"] for k in ("plan", "persona", "pipeline"))
    plan = reader.read_json(plan_root / "plan.json")
    marker = reader.read_json(plan_root / "published.json")
    _validate_plan(plan, cfg)
    _validate_marker(marker, cfg)
    if (reader.sha256(plan_root / "plan.json") != cfg["plan_sha256"]
            or reader.sha256(plan_root / "published.json") != cfg["marker_sha256"]):
        _refuse("published plan/marker byte identity differs")
    grading = reader.read_json(d / "grading-manifest.json")
    images = _validate_grading(grading)
    gate = reader.read_json(d / "gate.json")
    _validate_gate(gate, [row["image_id"] for row in images])
    evaluation = reader.read_json(d / "evaluation-inputs.json")
    _validate_evaluation(evaluation, lineage)
    persona = reader.read_json(persona_root / "persona.yaml")
    if type(persona) is not dict or type(persona.get("identity")) is not dict:
        _refuse("persona identity shape refused")
    if reader.file(persona_root / "training.yaml", required=False) is not None:
        reader.read_json(persona_root / "training.yaml")  # Same bounded JSON contract as real training loader.
    identity, register = persona["identity"], persona.get("register")
    references = identity.get("references")
    if type(references) is not list or not 1 <= len(references) <= _MAX_PERSONA_REFS:
        _refuse("persona reference count refused")
    if (type(identity.get("spec")) is not dict or type(register) is not dict
            or type(register.get("spec")) is not dict):
        _refuse("persona specification shape refused")

    initial_by_key = {_norm(m.path): m for m in initial}
    subject_members = {_norm(path): initial_by_key[_norm(path)] for path in a_paths}
    a_roles = ("plan", "published_marker", "grading", "evaluation", "numeric_gate", "persona", "training", "threshold")
    roles = {_norm(path): {role} for path, role in zip(a_paths, a_roles)}
    classes = {_norm(path): "text" for path in a_paths}
    added, operands = {}, {}

    def add(path, role, *, image=False, json_file=False):
        key, category = _norm(path), "png" if image else "text"
        if key in classes and classes[key] != category:
            _refuse("one path cannot be both text and PNG")
        classes[key] = category
        bound = _MAX_PNG_BYTES if image else _MAX_JSON_BYTES if json_file else _MAX_TEXT_BYTES
        new = _member(reads, path, max_bytes=bound, allow_json=json_file)
        if key in initial_by_key:
            existing = initial_by_key[key]
            if existing.max_bytes > new.max_bytes or (json_file and not existing.allow_json) or existing.optional:
                _refuse("derived role would change original A restriction")
            if key not in subject_members:
                _refuse("output probe cannot become an input")
        elif key in added:
            existing = added[key]
            added[key] = _member(reads, existing.path, max_bytes=min(existing.max_bytes, bound),
                                  allow_json=existing.allow_json or json_file)
            subject_members[key] = added[key]
        else:
            added[key] = new
            subject_members[key] = new
        roles.setdefault(key, set()).add(role)
        return subject_members[key].path

    def relative(base, value, allowed, *, persona_path=False):
        path, directories = _join_relative(base, value, allowed, persona=persona_path)
        for directory in directories:
            operands[_norm(directory)] = directory
        return path

    manifest = relative(plan_root, plan["stages"]["gen"]["runs"][0]["manifest"], (plan_root,))
    add(manifest, "gen_manifest", json_file=True)
    graded = []
    graded_paths = set()
    for row in images:
        path = _drive_absolute(row["path"].replace("/", "\\"), "graded PNG")
        if not _contains(plan_root, path) or _norm(path) == _norm(plan_root):
            _refuse("graded PNG is outside selected plan")
        key = _norm(path)
        if key in graded_paths:
            _refuse("graded PNG paths must be distinct")
        graded_paths.add(key)
        graded.append((row["image_id"], add(path, "graded_png", image=True)))
    anchors = [add(relative(plan_root, value, (plan_root,)), "anchor_png", image=True)
               for value in plan["assets"]["anchors"]]
    persona_refs = [add(relative(persona_root, value, (persona_root,), persona_path=True),
                        "persona_reference", image=True) for value in references]
    add(relative(persona_root, identity["spec"].get("path"), (persona_root,), persona_path=True), "identity_spec")
    add(relative(persona_root, register["spec"].get("path"), (persona_root, pipeline_root), persona_path=True), "register_spec")
    reader.finalize_admission(members=tuple(added.values()), directories=tuple(operands.values()))
    if not reader.admission_sealed:
        _refuse("admission did not seal")
    sizes = {}
    for key, member in subject_members.items():
        observed = reader.file(member.path, required=not member.optional)
        sizes[key] = 0 if observed is None else observed.size
    # B's first bounded observation supplies sizes; refuse domain totals before
    # any legacy authority/PNG pass. No second admission or filesystem fallback.
    occurrence_paths = [path for _, path in graded] + anchors + persona_refs
    m_bytes = sum(sizes[_norm(path)] for path in occurrence_paths)
    j_bytes = sum(size for key, size in sizes.items() if classes[key] == "text")
    if m_bytes > _MAX_M_BYTES or j_bytes > _MAX_J_BYTES:
        _refuse("domain image/text budget exceeded")
    loaded, root = driver._load_plan(CREATOR, plan_root / "plan.json", reads=reader)
    subject = driver._current_review_subject(loaded, root, STAGE, grading, reads=reader)
    lineage.assert_current(evaluation, subject, label="gen numeric evaluation")
    subject_sha = lineage.canonical_sha256(subject)
    png_cache = {}
    for path in occurrence_paths:
        key = _norm(path)
        if key not in png_cache:
            raw = reader.read_bytes(path)
            width, height = _validate_png(raw)
            png_cache[key] = {"width": width, "height": height, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    asset_map, graded_out, reference_out = {}, [], []
    for index, (image_id, path) in enumerate(graded, 1):
        asset_id = f"g{index}"
        asset_map[asset_id] = str(path)
        graded_out.append({"asset_id": asset_id, "image_id": image_id, **png_cache[_norm(path)]})
    for role, paths_in_role in (("anchor", anchors), ("persona_identity", persona_refs)):
        for path in paths_in_role:
            asset_id = f"r{len(reference_out) + 1}"
            asset_map[asset_id] = str(path)
            reference_out.append({"asset_id": asset_id, "role": role, **png_cache[_norm(path)]})
    raw_baseline = reader.export_baseline()  # This is the sole final full recheck.
    baseline = json.loads(raw_baseline, object_pairs_hook=_dup_pairs, parse_constant=_no_constant)
    common_sha, binding_sha = _subject_binding(cfg, baseline, subject_members, roles, tuple(operands.values()), subject_sha)
    envelope = {
        "schema": SUCCESS_SCHEMA, "operation": OPERATION, "creator": CREATOR, "stage": STAGE,
        "plan_id": cfg["plan_id"], "plan_sha256": cfg["plan_sha256"], "subject": subject,
        "subject_sha256": subject_sha, "graded": graded_out, "reference": reference_out,
        "asset_paths": asset_map, "common_config_sha256": common_sha,
        "subject_binding_version": 1, "subject_binding_sha256": binding_sha,
        "baseline": raw_baseline.decode("ascii"), "baseline_bytes": len(raw_baseline),
        "baseline_sha256": hashlib.sha256(raw_baseline).hexdigest(),
    }
    if len(_canonical_bytes(envelope) + b"\n") > MAX_ENVELOPE_BYTES:
        _refuse("whole escaped result exceeds cap")
    bootstrap.finish()
    return envelope



# ---------------------------------------------------------------------------
# One-shot CLI surface
# ---------------------------------------------------------------------------

_INVOKED = False


def _fixed_error_bytes() -> bytes:
    return _canonical_bytes({"schema": ERROR_SCHEMA, "ok": False}) + b"\n"


def _emit(data: bytes) -> bool:
    try:
        stream = sys.stdout
        buffer = stream.buffer
        stream.flush()
        written = buffer.write(data)
        if type(written) is not int or written != len(data):
            return False
        buffer.flush()
        return True
    except BaseException:
        return False


def main(argv: list | None = None) -> int:
    global _INVOKED
    if _INVOKED:
        return 1  # A prior invocation/emission failure must never emit twice.
    _INVOKED = True
    try:
        args = sys.argv[1:] if argv is None else argv
        if type(args) not in (list, tuple) or len(args) != 2 or args[0] != "--config-json" or type(args[1]) is not str:
            _refuse("exact config argument required")
        envelope = observe_open(parse_config_json(args[1]))
        data = _canonical_bytes(envelope) + b"\n"
        if len(data) > MAX_ENVELOPE_BYTES:
            _refuse("whole escaped result exceeds cap")
        code = 0
    except Exception:
        data, code = _fixed_error_bytes(), 1
    return code if _emit(data) else 1



if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
