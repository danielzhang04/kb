"""Read-only current-source observation for one compiled Figment ``gen`` plan.

This module adds no approval, launch, quality or atomicity authority. Importing it
performs no data I/O and executes no project code.

Runtime boundary (one-shot process)
-----------------------------------
The adapter is meant for exactly one call per fresh ``py -3 -I -B`` process. Both
``main`` and ``observe_gen_source`` refuse unless ``sys.flags.isolated`` and
``sys.flags.dont_write_bytecode`` are set. The caller pins this adapter file itself.

Before any dependency executes, the adapter records a baseline of the modules already
loaded from the project ``pipeline`` directory. Each module is located by ``__file__``
or ``__spec__.origin``. The only module allowed in that baseline is this adapter file.
Any other refuses, and the adapter deletes nothing from ``sys.modules``.

The adapter then reads the bytes of exactly five sibling sources and checks each
against a caller-supplied SHA256 pin:

* ``observed_reads.py``
* ``figment_train.py``
* ``training_config.py``
* ``persona.py``
* ``lineage.py``

Each read is bounded to a regular, non-reparse file. The adapter compiles those
verified bytes directly, with no ``SourceFileLoader`` and no ``__pycache__``, under the
aliases the domain loaders use. Any already present alias refuses, as does any known
unpinned project loader alias.

Immediately after bootstrap, the set of project-pipeline modules must equal the
baseline plus the five dependency aliases. Each entry must keep its exact object
identity and file path. The same exact-set check runs again after domain validation.
The bootstrap cannot stop an unpinned project module from executing. It can only refuse
to produce output when one appears.

After all data rechecks, the adapter rehashes the five code files. It does not verify
the Python runtime, the standard library, or a privileged or uncooperative concurrent
writer. Detection is cooperative: a module that hides its location, or code that
mutates ``sys.modules``, is not caught.

Caller preconditions (not verified)
-----------------------------------
* **Canonical spelling.** Every configured root, and the checkout containing this
  adapter, is given in its canonical on-disk spelling. That means the real letter case,
  no 8.3 short names, and no junction, symlink, ``subst`` or network alias. Routing and
  role isolation compare lexical keys only.
* **Quiet ancestors.** Two distinct assumptions are in play. For *code* files, the caller
  is trusted to supply a stable path for the whole process; ancestor renames or junction
  swaps behind that path are not guaranteed to be caught. For *data* paths, `ObservedReads`
  fingerprints the ancestor chain of every observed path, so ancestor changes present at
  comparison time -- including harmless directory churn -- are treated as observed changes
  and rejected; this is not weakened. What is not guaranteed is detection of a revert
  between checks (ABA) or changes made by a sufficiently privileged writer that can also
  alter the fingerprinting inputs themselves. Only files whose content was actually hashed
  are re-streamed and rehashed at the final recheck; references consulted only for metadata
  or identity keep the metadata/identity checks described above, not a content rehash. This
  note does not extend any guarantee against ABA reverts or a sufficiently privileged writer
  as described. `SourceConfig` values supplied in-process are trusted caller configuration;
  the CLI still validates the raw spelling and digests it receives.

Data boundary
-------------
The adapter builds three immutable, retained ``ObservedReads`` readers from fixed
configuration and fixed producer names:

* **A** reads fixed documents.
* **B** reads the manifests named by A.
* **C** reads the exact leaves and receipts named by A and B.

Roots are the module-derived canonical Figment root plus the configured selected and
source roots, deduplicated to at most three:

* The selected and source roots may sit under the canonical root.
* They must not overlap each other, the persona directory, or ``pipeline``.
* They must not contain the canonical root.

An adapter-local router sends every read to the reader that first admitted that path.
A compatible repeated registration keeps its first owner; a conflicting one refuses.

The existing domain chain runs through the router: ``_load_plan`` and
``_validate_gen_source_inputs``. Both are seams from separately assigned
``figment_train`` revisions; if either is missing, the result is unavailable. After
that, each gen manifest's original-reader SHA256 is compared with the plan's
``run.sha256``. Readers are rechecked in the order C, B, A and then sealed. Code is then
rehashed, and only then is a result returned.

Invocation (exactly these six flags, each once, ``--flag value`` form)::

    py -3 -I -B orgs\\figment\\pipeline\\gen_source_read.py
        --creator creator-001
        --selected-root D:\\abs\\gen-plan-dir --selected-plan-sha256 <64 hex>
        --source-root D:\\abs\\tester-plan-dir --source-plan-sha256 <64 hex>
        --dependency-sha256 "{\\"observed_reads.py\\":\\"<hex>\\",...five keys...}"

Output
------
Output is one bounded ASCII line ending in LF, written as bytes to the stdout binary
buffer and then flushed.

* Success: exit 0 and one fixed-schema JSON line of digests.
* Argument, bootstrap, domain or serialization failure: exit 1, and the adapter
  *attempts* one identical line, ``{"result":"unavailable","schema":...}``.
* Output stream failure: if the write or flush itself fails, the exit code is 1 and no
  line is promised. A partially written success line is never followed by a second
  line.

No paths or exception text are printed, no traceback is shown, and nothing is written
to disk.

Not claimed
-----------
Launch readiness, image or checkpoint quality, an atomic snapshot, and validation of
detail-image or workflow content.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import ntpath
import os
from pathlib import Path
import re
import stat
import sys
import types

RESULT_SCHEMA = "figment/gen-source-read@1"
_ADAPTER_FILE = Path(__file__).resolve()
_HERE = _ADAPTER_FILE.parent
_KIB, _MIB = 1024, 1024 ** 2
_SHA = re.compile(r"[0-9a-f]{64}\Z")
_CREATOR = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*\Z")
_TRIGGER = re.compile(r"[a-z][a-z0-9]{0,63}\Z")
_CHECKPOINT = re.compile(r"[a-z][a-z0-9_]{0,95}\.safetensors\Z")
_OUTPUT_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z")
_DRIVE_ABSOLUTE = re.compile(r"[A-Za-z]:[\\/]")
_JSON_BYTES = 256 * _KIB
_SPEC_BYTES = 256 * _KIB
_IMAGE_BYTES = 32 * _MIB
_CHECKPOINT_BYTES = 256 * _MIB
_SOURCE_BYTES = 512 * _KIB
_OUTPUT_BYTES = 4 * _KIB
_PERSONA_DIR = "orgs/figment/personas/{creator}"

# Frozen role caps.
MAX_REFERENCES = 8      # R
MAX_ANCHORS = 8         # K
MAX_IMAGES = 16         # I
MAX_GEN_RUNS = 2        # G (minimum 1)

# Fixed per-reader partitions: (files, unique bytes, stream bytes, file bytes, operations).
# The rows sum to 256 files, 1 GiB unique bytes, 2 GiB streamed bytes and 1024 operations.
# Quota never moves between readers. This is conservative availability: not every role
# maximum necessarily fits.
PHASE_LIMITS = {
    "A": (16, 4 * _MIB, 32 * _MIB, 256 * _KIB, 384),
    "B": (96, 64 * _MIB, 128 * _MIB, 256 * _KIB, 256),
    "C": (144, 956 * _MIB, 1888 * _MIB, 256 * _MIB, 384),
}

# Source file and the exact alias its domain loader uses. Execution order matters.
_DEPENDENCIES = (
    ("observed_reads.py", "_figment_gen_source_observed_reads"),
    ("persona.py", "_figment_training_config_persona"),
    ("lineage.py", "_figment_train_lineage"),
    ("training_config.py", "_figment_train_training_config"),
    ("figment_train.py", "_figment_gen_source_figment_train"),
)
_DEPENDENCY_NAMES = frozenset(name for name, _ in _DEPENDENCIES)
# Unpinned project loader aliases. A preplanted alias would substitute a validator; one
# appearing later would mean unverified project code ran. Either way, no result.
_FORBIDDEN_ALIASES = (
    "_figment_train_render_config", "_figment_train_build_set", "_figment_train_qa_stamp",
    "_figment_train_score_cells", "_figment_train_identity_gate",
    "_figment_train_pod_runpod_run", "_figment_train_verify_pins",
    "_figment_pipeline_pod_runpod_run", "_figment_pipeline_persona_gates",
)
_FLAGS = ("--creator", "--selected-root", "--selected-plan-sha256",
          "--source-root", "--source-plan-sha256", "--dependency-sha256")


class GenSourceUnavailable(RuntimeError):
    """Fixed refusal. The cause is kept only for in-process diagnosis."""


class _Refusal(ValueError):
    pass


def _refuse(reason: str) -> None:
    raise _Refusal(reason)


def _dict(value):
    if type(value) is not dict:
        _refuse("expected object")
    return value


def _list(value, low: int, high: int) -> list:
    if type(value) is not list or not low <= len(value) <= high:
        _refuse("list shape or bound")
    return value


def _int(value, low: int, high: int) -> bool:
    return type(value) is int and low <= value <= high


def _raw_absolute(value) -> Path:
    """Validate a raw drive-absolute string before Path can discard its spelling."""
    if (not isinstance(value, str) or not 3 < len(value) <= 4096
            or not _DRIVE_ABSOLUTE.match(value)
            or any(part in ("", ".", "..") for part in re.split(r"[\\/]", value[3:]))):
        _refuse("unsupported absolute spelling")
    return Path(value)


def _relative(persona_module, value, *, prefix: tuple = (), length: int | None = None,
              suffix: str | None = None) -> tuple:
    """A plain in-root relative path with no parent traversal, in a fixed role shape."""
    if not isinstance(value, str):
        _refuse("relative path must be a string")
    leading, parts = persona_module._observed_reference_parts(value, "source")
    if (leading or tuple(parts[:len(prefix)]) != prefix
            or (length is not None and len(parts) != length)
            or (suffix is not None and not parts[-1].lower().endswith(suffix))):
        _refuse("relative path outside its producer role")
    return tuple(parts)


def _parse_pins(text) -> tuple:
    if not isinstance(text, str) or not 0 < len(text) <= 1024:
        _refuse("pin mapping length")

    def pairs_hook(pairs):
        names = [name for name, _ in pairs]
        if len(set(names)) != len(names):
            _refuse("duplicate pin")
        return dict(pairs)

    def no_constant(_):
        _refuse("pin constant")

    value = json.loads(text, object_pairs_hook=pairs_hook, parse_constant=no_constant)
    if type(value) is not dict or set(value) != _DEPENDENCY_NAMES:
        _refuse("pin mapping keys")
    if any(not isinstance(digest, str) or not _SHA.fullmatch(digest) for digest in value.values()):
        _refuse("pin digest")
    return tuple(sorted(value.items()))


# ---------------------------------------------------------------------------
# Project-module accounting (cooperative: __file__ / __spec__.origin only)
# ---------------------------------------------------------------------------

def _norm_location(location: str) -> str:
    try:
        return ntpath.normcase(os.path.abspath(location))
    except (ValueError, TypeError, OSError):
        _refuse("unnormalizable module location")


_PIPELINE_PREFIX = ntpath.normcase(str(_HERE)).rstrip("\\") + "\\"
_ADAPTER_KEY = ntpath.normcase(str(_ADAPTER_FILE))


def _module_locations(module) -> list:
    found = []
    location = getattr(module, "__file__", None)
    if isinstance(location, str):
        found.append(_norm_location(location))
    spec = getattr(module, "__spec__", None)
    origin = getattr(spec, "origin", None) if spec is not None else None
    if isinstance(origin, str) and origin not in ("built-in", "frozen"):
        found.append(_norm_location(origin))
    return found


def _project_modules() -> dict:
    """Name -> module for every loaded module located under the project pipeline."""
    found: dict = {}
    for name, module in tuple(sys.modules.items()):
        if any(loc.startswith(_PIPELINE_PREFIX) for loc in _module_locations(module)):
            found[name] = module
    return found


def _require_project_modules(expected: dict) -> None:
    current = _project_modules()
    if set(current) != set(expected) or any(current[name] is not expected[name] for name in expected):
        _refuse("unexpected project module set")


# ---------------------------------------------------------------------------
# Exact five-dependency source-byte bootstrap
# ---------------------------------------------------------------------------

def _read_source(path: Path) -> bytes:
    info = os.lstat(path)
    if (not stat.S_ISREG(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400
            or not 0 < info.st_size <= _SOURCE_BYTES):
        _refuse("dependency source kind or size")
    with open(path, "rb", buffering=0) as handle:
        opened = os.fstat(handle.fileno())
        if (opened.st_dev, opened.st_ino, opened.st_size) != (info.st_dev, info.st_ino, info.st_size):
            _refuse("dependency source identity")
        raw = handle.read(_SOURCE_BYTES + 1)
    if len(raw) != info.st_size:
        _refuse("dependency source length")
    return raw


class _Bootstrap:
    def __init__(self, pins: tuple):
        self._pins = dict(pins)
        if set(self._pins) != _DEPENDENCY_NAMES:
            _refuse("pin mapping")
        self.modules: dict = {}

    def load(self) -> None:
        for _, alias in _DEPENDENCIES:
            if alias in sys.modules:
                _refuse("preplanted dependency alias")
        for alias in _FORBIDDEN_ALIASES:
            if alias in sys.modules:
                _refuse("preplanted project alias")
        verified = []
        for name, alias in _DEPENDENCIES:  # Verify every byte before executing any of it.
            path = _HERE / name
            raw = _read_source(path)
            if hashlib.sha256(raw).hexdigest() != self._pins[name]:
                _refuse("dependency pin mismatch")
            verified.append((name, alias, path, raw))
        for name, alias, path, raw in verified:
            code = compile(raw, str(path), "exec", dont_inherit=True)
            module = types.ModuleType(alias)
            module.__file__ = str(path)
            module.__loader__ = None
            module.__package__ = ""
            sys.modules[alias] = module  # Left in place on failure: one-shot poison.
            exec(code, module.__dict__)
            self.modules[name] = module
        self.check_identity()

    def expected_modules(self, baseline: dict) -> dict:
        expected = dict(baseline)
        for name, alias in _DEPENDENCIES:
            if alias in expected:
                _refuse("dependency alias in baseline")
            expected[alias] = self.modules[name]
        return expected

    def check_identity(self) -> None:
        for name, alias in _DEPENDENCIES:
            module = self.modules.get(name)
            want = ntpath.normcase(str(_HERE / name))
            if (module is None or sys.modules.get(alias) is not module
                    or not isinstance(getattr(module, "__file__", None), str)
                    or ntpath.normcase(module.__file__) != want
                    or any(loc != want for loc in _module_locations(module))):
                _refuse("dependency module identity")

    def rehash(self) -> None:
        self.check_identity()
        for name, _ in _DEPENDENCIES:
            if hashlib.sha256(_read_source(_HERE / name)).hexdigest() != self._pins[name]:
                _refuse("dependency changed after observation")


def _limits(obs, phase: str):
    files, unique, stream, file_bytes, operations = PHASE_LIMITS[phase]
    return obs.ReadLimits(
        max_files=files, max_unique_bytes=unique, max_stream_bytes=stream,
        max_file_bytes=file_bytes, max_json_bytes=_JSON_BYTES, max_json_depth=32,
        max_json_entries=256, max_json_nodes=8192, max_operations=operations,
    )


class _Router:
    """Exact-owner routing over retained readers. It never falls back or discovers paths."""

    def __init__(self, obs):
        self._obs = obs
        self._readers: list = []
        self._files: dict = {}
        self._restrictions: dict = {}
        self._dirs: dict = {}
        self._touched: set | None = None
        self._poisoned = False
        self._sealed = False

    def poison(self) -> None:
        self._poisoned = True

    def _enter(self) -> None:
        if self._poisoned or self._sealed:
            _refuse("router poisoned or sealed")

    def admit(self, roots, members, directories, limits) -> None:
        self._enter()
        try:
            obs = self._obs
            key, lexical, within = obs._key, obs._lexical, obs._within
            roots = tuple(lexical(root) for root in roots)
            directories = tuple(lexical(directory) for directory in directories)
            fresh: dict = {}
            for member in members:
                if type(member) is not obs.ReadMember:
                    _refuse("member type")
                path = lexical(member.path)
                member_key = key(path)
                restriction = (member.max_bytes, member.allow_json, member.optional)
                prior = self._restrictions.get(member_key)
                if prior is None and member_key in fresh:
                    prior = fresh[member_key][1]
                if prior is not None:
                    if prior != restriction:
                        _refuse("incompatible repeated member")
                    continue  # Compatible repeat keeps its first owner.
                if member_key in self._dirs:
                    _refuse("member routing collision")
                fresh[member_key] = (obs.ReadMember(path, *restriction), restriction)
            new_members = tuple(item for item, _ in fresh.values())
            dirs = {key(path): path for path in (*roots, *directories)}
            for member in new_members:
                for ancestor in member.path.parents:
                    if any(within(ancestor, root) for root in roots):
                        dirs.setdefault(key(ancestor), ancestor)
            if fresh.keys() & dirs.keys() or dirs.keys() & self._restrictions.keys():
                _refuse("file and directory routing conflict")
            reader = obs.ObservedReads(
                roots=roots, members=new_members, directories=directories, limits=limits,
            )
        except BaseException:
            self._poisoned = True
            raise
        self._readers.append(reader)
        for member_key, (_, restriction) in fresh.items():
            self._files[member_key] = reader
            self._restrictions[member_key] = restriction
        for dir_key, path in dirs.items():
            self._dirs.setdefault(dir_key, reader)

    def _route(self, path, *, file_only: bool):
        obs = self._obs
        if isinstance(path, str):
            path = _raw_absolute(path)
        path = obs._lexical(path)
        path_key = obs._key(path)
        reader = self._files.get(path_key)
        if reader is not None:
            if self._touched is not None:
                self._touched.add(path_key)
            return reader, path
        if not file_only and path_key in self._dirs:
            return self._dirs[path_key], path
        _refuse("operand was not routed")

    def _call(self, method: str, path, file_only: bool, **kwargs):
        self._enter()
        try:
            reader, path = self._route(path, file_only=file_only)
            return getattr(reader, method)(path, **kwargs)
        except BaseException:
            self._poisoned = True
            raise

    def resolve(self, path):
        return self._call("resolve", path, False)

    def file(self, path, *, required=False):
        return self._call("file", path, True, required=required)

    def sha256(self, path):
        return self._call("sha256", path, True)

    def read_json(self, path):
        return self._call("read_json", path, True)

    def begin_domain(self) -> None:
        self._enter()
        self._touched = set()

    def recheck(self) -> None:
        self._enter()
        try:
            if len(self._readers) != 3 or self._touched is None:
                _refuse("incomplete phase construction")
            if set(self._files) - self._touched:
                _refuse("admitted member was not observed by domain validation")
            for reader in reversed(self._readers):  # C, then B, then A.
                reader.recheck()
        except BaseException:
            self._poisoned = True
            raise
        self._sealed = True


@dataclass(frozen=True)
class SourceConfig:
    """Trusted caller configuration. No value here is derived from observed data."""

    creator: str
    selected_root: Path
    selected_plan_sha256: str
    source_root: Path
    source_plan_sha256: str
    dependency_sha256: tuple


_CALLED = False


def observe_gen_source(config: SourceConfig) -> dict:
    global _CALLED
    state: dict = {}
    try:
        if _CALLED:
            _refuse("one-shot adapter already used")
        _CALLED = True
        return _observe(config, state)
    except BaseException as exc:
        if state.get("router") is not None:
            state["router"].poison()
        raise GenSourceUnavailable("current gen source is unavailable") from exc


def _observe(config: SourceConfig, state: dict) -> dict:
    # ---- Runtime flags and trusted configuration ---------------------------------
    if sys.flags.isolated != 1 or sys.flags.dont_write_bytecode != 1:
        _refuse("isolated -B invocation required")
    if type(config) is not SourceConfig:
        _refuse("config type")
    creator = config.creator
    if not isinstance(creator, str) or len(creator) > 64 or not _CREATOR.fullmatch(creator):
        _refuse("creator")
    for digest in (config.selected_plan_sha256, config.source_plan_sha256):
        if not isinstance(digest, str) or not _SHA.fullmatch(digest):
            _refuse("configured digest")
    if not isinstance(config.selected_root, Path) or not isinstance(config.source_root, Path):
        _refuse("configured roots")
    if type(config.dependency_sha256) is not tuple:
        _refuse("dependency pins")

    # ---- Project-module baseline, captured before any dependency executes ---------
    baseline = _project_modules()
    for module in baseline.values():
        locations = _module_locations(module)
        if not locations or any(loc != _ADAPTER_KEY for loc in locations):
            _refuse("preexisting project module is not this adapter")

    # ---- Code bootstrap: verified bytes compiled under actual aliases -------------
    boot = _Bootstrap(config.dependency_sha256)
    boot.load()
    expected_modules = boot.expected_modules(baseline)
    _require_project_modules(expected_modules)
    if any(alias in sys.modules for alias in _FORBIDDEN_ALIASES):
        _refuse("unpinned project module executed during bootstrap")

    obs, ft = boot.modules["observed_reads.py"], boot.modules["figment_train.py"]
    tc, pm = boot.modules["training_config.py"], boot.modules["persona.py"]
    if (ft._training_config_module() is not tc or tc._load_persona_module() is not pm
            or ft._lineage_module() is not boot.modules["lineage.py"]):
        _refuse("dependency alias binding")
    _require_project_modules(expected_modules)
    key, within, lexical, M = obs._key, obs._within, obs._lexical, obs.ReadMember

    figment = lexical(Path(ft.ROOT) / "orgs" / "figment")
    pipeline = figment / "pipeline"
    if key(Path(ft.HERE)) != key(pipeline) or key(_HERE) != key(pipeline):
        _refuse("module root binding")

    # ---- Fixed roots and role isolation ------------------------------------------
    selected, source = lexical(config.selected_root), lexical(config.source_root)
    home = figment / "personas" / creator
    if within(selected, source) or within(source, selected):
        _refuse("selected and source roots overlap")
    for role_root in (selected, source):
        if within(figment, role_root):
            _refuse("role root contains the canonical root")
        for protected in (home, pipeline):
            if within(role_root, protected) or within(protected, role_root):
                _refuse("role root overlaps a canonical role")
    ordered: dict = {}
    for root in (figment, selected, source):
        ordered.setdefault(key(root), root)
    roots = tuple(ordered.values())
    if len(roots) > 3:
        _refuse("root count")

    persona_path, sidecar = home / "persona.yaml", home / "training.yaml"
    selected_plan, source_plan = selected / "plan.json", source / "plan.json"
    grade = source / "grade" / "tester"
    accepted, grading_path = grade / "accepted-checkpoint.json", grade / "grading-manifest.json"

    # ---- Phase A: fixed documents -------------------------------------------------
    router = _Router(obs)
    state["router"] = router
    router.admit(roots, (
        M(selected_plan, _JSON_BYTES, True), M(persona_path, _JSON_BYTES, True),
        M(sidecar, _JSON_BYTES, True, True), M(source_plan, _JSON_BYTES, True),
        M(accepted, _JSON_BYTES, True), M(grade / "approval-lineage.json", _JSON_BYTES, True),
        M(grading_path, _JSON_BYTES, True), M(grade / "gate.json", _JSON_BYTES),
        M(grade / "evaluation-inputs.json", _JSON_BYTES, True, True),
        M(source / "stage.json", _JSON_BYTES, True, True), M(pipeline / "gate.yaml", _JSON_BYTES),
    ), (home,), _limits(obs, "A"))

    if (router.sha256(selected_plan) != config.selected_plan_sha256
            or router.sha256(source_plan) != config.source_plan_sha256):
        _refuse("configured plan digest")
    selected_doc = _dict(router.read_json(selected_plan))
    source_doc = _dict(router.read_json(source_plan))
    raw_persona = _dict(router.read_json(persona_path))
    side = router.read_json(sidecar) if router.file(sidecar, required=False) is not None else None
    grading = _dict(router.read_json(grading_path))

    for plan_doc in (selected_doc, source_doc):
        if (plan_doc.get("schema") != "figment/train-plan@1" or plan_doc.get("creator") != creator
                or _dict(plan_doc.get("assets")).get("persona_dir") != _PERSONA_DIR.format(creator=creator)):
            _refuse("plan is not bound to the canonical creator layout")
    if raw_persona.get("id") != creator:
        _refuse("persona creator")
    inline, side_training = raw_persona.get("training"), None
    if side is not None:
        if type(side) is not dict or set(side) != {"training"}:
            _refuse("sidecar shape")
        side_training = side["training"]
    if inline is not None and side_training is not None:
        _refuse("ambiguous training definition")
    current = tc.validate_training(inline if inline is not None else side_training, creator)
    step, approval_value = current["chosen_checkpoint_step"], current["chosen_checkpoint_approval"]
    if type(step) is not int or not isinstance(approval_value, str):
        _refuse("no selected checkpoint")
    approval_path = (lexical(_raw_absolute(approval_value)) if _DRIVE_ABSOLUTE.match(approval_value)
                     else lexical(Path(ft.ROOT).joinpath(*_relative(pm, approval_value))))
    if key(approval_path) != key(accepted):
        _refuse("chosen approval is not the configured source approval")

    # Persona leaves use B1's own lexical rule.
    def reference(value, field):
        if not isinstance(value, str):
            _refuse("reference type")
        leading, parts = pm._observed_reference_parts(value, field)
        base = home
        for _ in range(leading):
            base = base.parent
        return lexical(base.joinpath(*parts))

    identity = _dict(raw_persona.get("identity"))
    leaves: list = []
    for value in _list(identity.get("references"), 1, MAX_REFERENCES):
        path = reference(value, "identity.references[]")
        if not within(path, home) or key(path) == key(home):
            _refuse("reference escapes persona")
        leaves.append(M(path, _IMAGE_BYTES))
    identity_spec = reference(_dict(identity.get("spec")).get("path"), "identity.spec.path")
    register_spec = reference(
        _dict(_dict(raw_persona.get("register")).get("spec")).get("path"), "register.spec.path",
    )
    if (not within(identity_spec, home) or key(identity_spec) == key(home)
            or key(register_spec.parent) != key(pipeline)):
        _refuse("spec outside its role")
    leaves += [M(identity_spec, _SPEC_BYTES), M(register_spec, _SPEC_BYTES)]

    # Source filename comes from the actual producer (_checkpoint_candidate): unsuffixed at
    # the final step. The staged filename comes from _stage_accepted_checkpoint: always suffixed.
    source_training = _dict(source_doc.get("training"))
    trigger = source_training.get("trigger")
    steps, save_every = source_training.get("steps"), source_training.get("save_every")
    if (not isinstance(trigger, str) or not _TRIGGER.fullmatch(trigger)
            or not _int(steps, 1, 10 ** 7) or not _int(save_every, 1, 10 ** 7)
            or steps // save_every > 4096):
        _refuse("source training shape")
    if step not in ft._checkpoint_steps(steps, save_every) + [steps]:
        _refuse("selected step not produced by source plan")
    source_name = ft._checkpoint_name(trigger, None if step == steps else step)
    current_trigger = current.get("trigger")
    if not isinstance(current_trigger, str) or not _TRIGGER.fullmatch(current_trigger):
        _refuse("current trigger")
    staged_name = ft._checkpoint_name(current_trigger, step)
    if not _CHECKPOINT.fullmatch(source_name) or not _CHECKPOINT.fullmatch(staged_name):
        _refuse("checkpoint filename")

    def runs(plan_doc, stage, low, high):
        stages = _dict(plan_doc.get("stages"))
        return [_dict(run) for run in _list(_dict(stages.get(stage)).get("runs"), low, high)]

    def manifest_parts(run):
        return _relative(pm, run.get("manifest"), prefix=("train", "runs"), length=3, suffix=".yaml")

    def out_parts(run):
        return _relative(pm, run.get("out"), prefix=("train", "runs", "out"), length=4)

    gen_runs = runs(selected_doc, "gen", 1, MAX_GEN_RUNS)
    (train_run,) = runs(source_doc, "train", 1, 1)
    (tester_run,) = runs(source_doc, "tester", 1, 1)
    if grading.get("creator") != creator or grading.get("stage") != "tester":
        _refuse("grading manifest binding")
    images = _list(grading.get("images"), 1, MAX_IMAGES)
    anchors = _list(_dict(source_doc.get("assets")).get("anchors"), 1, MAX_ANCHORS)

    # ---- Phase B: manifests named by the A plans ----------------------------------
    gen_manifests = [lexical(selected.joinpath(*manifest_parts(run))) for run in gen_runs]
    if len({key(path) for path in gen_manifests}) != len(gen_manifests):
        _refuse("duplicate gen manifest")
    train_manifest = lexical(source.joinpath(*manifest_parts(train_run)))
    tester_manifest = lexical(source.joinpath(*manifest_parts(tester_run)))
    if key(train_manifest) == key(tester_manifest):
        _refuse("train and tester manifests coincide")
    router.admit((selected, source), tuple(
        M(path, _JSON_BYTES, True) for path in (*gen_manifests, train_manifest, tester_manifest)
    ), (), _limits(obs, "B"))

    outputs: set = set()
    mapped = 0
    for job in _list(_dict(router.read_json(tester_manifest)).get("jobs"), 1, MAX_IMAGES):
        job = _dict(job)
        name = job.get("output_name")
        if not isinstance(name, str) or not _OUTPUT_NAME.fullmatch(name) or name in outputs:
            _refuse("tester job output name")
        outputs.add(name)
        substitutions = [_dict(item) for item in _list(job.get("substitutions") or [], 0, 64)]
        if source_name in [item.get("value") for item in substitutions if item.get("field") == "lora_name"]:
            mapped += 1
    if mapped != 1:
        _refuse("tester slate does not map the selected checkpoint once")
    artifacts = _list(_dict(router.read_json(train_manifest)).get("artifacts"), 1, 64)
    if [_dict(item).get("local") for item in artifacts].count(source_name) != 1:
        _refuse("train manifest does not declare the selected checkpoint once")

    staged_dir = selected / "train" / "runs" / "accepted-checkpoint"
    staged: dict = {}
    for manifest_path in gen_manifests:
        declared = [
            value
            for upload in _list(_dict(router.read_json(manifest_path)).get("uploads") or [], 0, 8)
            for value in _list(_dict(upload).get("files") or [], 0, 64)
            if isinstance(value, str) and value.endswith(".safetensors")
        ]
        if len(declared) != 1 or any(char in declared[0] for char in "*?[]"):
            _refuse("gen manifest must upload one explicit checkpoint")
        path = lexical(manifest_path.parent.joinpath(
            *_relative(pm, declared[0], prefix=("accepted-checkpoint",), length=2)))
        if key(path.parent) != key(staged_dir) or path.name != staged_name:
            _refuse("staged checkpoint outside its role")
        staged.setdefault(key(path), path)
    if len(staged) != 1:
        _refuse("exactly one distinct staged checkpoint required")

    # ---- Phase C: exact leaves and receipts ---------------------------------------
    tester_out = lexical(source.joinpath(*out_parts(tester_run)))
    train_out = lexical(source.joinpath(*out_parts(train_run)))
    if key(tester_out) == key(train_out):
        _refuse("train and tester outputs coincide")
    image_ids: set = set()
    for row in images:
        row = _dict(row)
        image_id = row.get("image_id")
        if not isinstance(image_id, str) or image_id in image_ids:
            _refuse("grading image id")
        image_ids.add(image_id)
        path = lexical(_raw_absolute(row.get("path")))
        if (image_id not in outputs or key(path.parent) != key(tester_out)
                or path.suffix.lower() not in ft.IMAGE_EXTENSIONS
                or path.stem not in (image_id, f"{image_id}_03")):
            _refuse("grading image outside its producer role")
        leaves.append(M(path, _IMAGE_BYTES))
    if image_ids != outputs:
        _refuse("grading images do not cover exactly the tester outputs")
    for value in anchors:
        parts = _relative(pm, value, prefix=("expand", "runs", "_uploads", creator), length=5)
        leaves.append(M(lexical(source.joinpath(*parts)), _IMAGE_BYTES))
    leaves += [
        M(train_out / source_name, _CHECKPOINT_BYTES),
        M(train_out / "run.json", _JSON_BYTES, True),
        M(tester_out / "run.json", _JSON_BYTES, True),
        *(M(path, _CHECKPOINT_BYTES) for path in staged.values()),
    ]
    router.admit(roots, tuple(leaves), (), _limits(obs, "C"))

    # ---- Existing domain validation through the retained router --------------------
    router.begin_domain()
    plan, root = ft._load_plan(creator, selected_plan, reads=router)
    if type(plan) is not dict or not isinstance(root, Path) or key(root) != key(selected):
        _refuse("selected plan root binding")
    ft._validate_gen_source_inputs(plan, root, reads=router)

    # The native launch boundary compares each manifest with its plan digest, so repeat it here.
    domain_gen = runs(plan, "gen", 1, MAX_GEN_RUNS)
    if len(domain_gen) != len(gen_manifests):
        _refuse("gen run set changed")
    manifest_digests = []
    for run, manifest_path in zip(domain_gen, gen_manifests):
        if key(lexical(selected.joinpath(*manifest_parts(run)))) != key(manifest_path):
            _refuse("gen run manifest changed")
        recorded = run.get("sha256")
        if not isinstance(recorded, str) or not _SHA.fullmatch(recorded) or router.sha256(manifest_path) != recorded:
            _refuse("gen manifest digest differs from plan")
        manifest_digests.append(recorded)

    authority = _dict(plan.get("gen_authority"))
    digests = {"persona_sha256": plan.get("persona_sha256")}
    for field in ("approval_sha256", "approval_lineage_sha256", "source_plan_sha256", "checkpoint_sha256"):
        digests[field] = authority.get(field)
    if any(not isinstance(value, str) or not _SHA.fullmatch(value) for value in digests.values()):
        _refuse("result digest shape")
    if digests["source_plan_sha256"] != config.source_plan_sha256:
        _refuse("compiled authority names another source plan")
    summary = {
        "schema": RESULT_SCHEMA,
        "result": "current-source-observed",
        "creator": creator,
        "selected_plan_sha256": config.selected_plan_sha256,
        **digests,
        "gen_manifest_sha256": manifest_digests,
        "gen_runs": len(gen_runs),
        "claims": {"launch_ready": False, "quality_approved": False, "atomic_snapshot": False},
    }

    # ---- Final data rechecks (C, B, A), then code checks ---------------------------
    router.recheck()
    if any(alias in sys.modules for alias in _FORBIDDEN_ALIASES):
        _refuse("unpinned project module executed")
    _require_project_modules(expected_modules)
    boot.rehash()
    return summary


_UNAVAILABLE = json.dumps({"result": "unavailable", "schema": RESULT_SCHEMA},
                          sort_keys=True, separators=(",", ":"))


def _parse_argv(argv) -> SourceConfig:
    if type(argv) not in (list, tuple) or len(argv) != 2 * len(_FLAGS):
        _refuse("argument count")
    values: dict = {}
    for index in range(0, len(argv), 2):
        flag, value = argv[index], argv[index + 1]
        if (not isinstance(flag, str) or flag not in _FLAGS or flag in values
                or not isinstance(value, str) or len(value) > 4096):
            _refuse("argument shape")
        values[flag] = value
    return SourceConfig(
        creator=values["--creator"],
        selected_root=_raw_absolute(values["--selected-root"]),
        selected_plan_sha256=values["--selected-plan-sha256"],
        source_root=_raw_absolute(values["--source-root"]),
        source_plan_sha256=values["--source-plan-sha256"],
        dependency_sha256=_parse_pins(values["--dependency-sha256"]),
    )


def _encode_line(line) -> bytes:
    """Exact bounded ASCII (hence UTF-8) bytes: one line, one terminating LF."""
    if type(line) is not str:
        _refuse("output type")
    data = line.encode("ascii") + b"\n"
    if len(data) > _OUTPUT_BYTES or data.count(b"\n") != 1 or b"\r" in data:
        _refuse("output shape")
    return data


def _emit(data: bytes) -> bool:
    """One binary write plus flush. Any failure or short write returns False; never retried."""
    try:
        stream = sys.stdout
        buffer = stream.buffer
        stream.flush()  # Nothing is pending on the text layer; keep byte order exact.
        written = buffer.write(data)
        if type(written) is not int or written != len(data):
            return False
        buffer.flush()
        return True
    except BaseException:
        return False


def _silence_stdout() -> None:
    """Detach the stream reference for callers after a failed write.

    This alone does not prevent finalization flush noise; the CLI's use of
    ``os._exit`` is what skips normal interpreter finalization and any retry
    noise it could otherwise produce on the broken stream.
    """
    try:
        sys.stdout = None
    except BaseException:
        pass


def main(argv: list[str] | None = None) -> int:
    try:
        if sys.flags.isolated != 1 or sys.flags.dont_write_bytecode != 1:
            _refuse("isolated -B invocation required")
        config = _parse_argv(sys.argv[1:] if argv is None else argv)
        summary = observe_gen_source(config)
        data = _encode_line(json.dumps(summary, sort_keys=True, separators=(",", ":")))
    except BaseException:
        try:
            if not _emit(_encode_line(_UNAVAILABLE)):
                _silence_stdout()
        except BaseException:
            _silence_stdout()
        return 1
    try:
        if _emit(data):
            return 0
    except BaseException:
        pass
    # Success bytes may be partially written: never append an unavailable line.
    _silence_stdout()
    return 1


if __name__ == "__main__":
    _exit_code = main()
    os._exit(_exit_code)
