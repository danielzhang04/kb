#!/usr/bin/env python3
"""forge_codex — the codex-CLI image engine, a standalone peer runner beside forge.py.

Ruling 7 (2026-08-11): zero forge.py edits. This module imports forge.py read-only as a library
(shot truth + staging discipline) and owns everything provider-specific: the prompt composer, the
``codex exec`` invocation, harvest, fidelity audit, normalization, failure classification and engine
log. ``git diff forge.py`` must stay empty.

Subscription-billed: $0 API spend. No key is ever loaded — every Kit is built dry.
"""
import glob
import hashlib
import json
import os
import signal
import shutil
import subprocess
import sys
import time
import warnings
if os.name == "nt":
    import ctypes
    from ctypes import wintypes
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from forge import (Kit, SeedIntegrityError, SEED_CAP, _existing_staging_png,  # noqa: E402
                   _publish_staging_png, _release_staging_lock, _reserve_staging_output,
                   _staging_png, _stem, preflight_batch, resolve_request_seeds, to_png_bytes,
                   validate_png, verify_request_seed_digests)

# Environment is carried as module constants so tests patch it. Production exposes no environment
# variable override surface. ``resolve_codex_binary`` is called from the run loop, never at import.
CODEX_ARGV_PREFIX = ["codex"]
IMAGE_ROOT = os.path.expanduser("~/.codex/generated_images")
SESSIONS_ROOT = os.path.expanduser("~/.codex/sessions")
TIMEOUT_S = 240

ENGINE_ID = "codex-imagegen"
# §4.7: four content seeds per spec; reserve transport slot five for C15's study-only register seed.
CODEX_SEED_CAP = 4
TRANSPORT_SEED_CEILING = 5

# --- §4.6 normalization canvas. (16:9,1K) is VERIFIED MEASURED: all 23 baseline frames in
# --- scratch-codex-image-engine/gemini-baseline/ are 1376×768 (SKILL.md L130's "~1344×768"
# --- is an approximation). The (2:3,1K) and (9:16,1K) rows are UNVERIFIED and carried from
# --- SKILL.md L130; no frame at either ratio may be promoted at P5 until a real Gemini frame is
# --- measured (spec §8.5 probe 7). 2K rows are 2× linear. A pair absent from this table is an
# --- error, never a guess.
CANVAS: dict[tuple[str, str], tuple[int, int]] = {
    ("16:9", "1K"): (1376, 768),
    ("16:9", "2K"): (2752, 1536),
    ("2:3", "1K"): (832, 1248),
    ("2:3", "2K"): (1664, 2496),
    ("9:16", "1K"): (768, 1344),
    ("9:16", "2K"): (1536, 2688),
}


def resolve_canvas(aspect: str, image_size: str) -> tuple[int, int]:
    key = (str(aspect), str(image_size))
    if key not in CANVAS:
        raise SystemExit(f"no canvas row for (aspect={key[0]!r}, image_size={key[1]!r}) — measure a "
                         f"real frame of that pair before generating one (spec §4.6, §8.5 probe 7)")
    return CANVAS[key]


def framing_line(aspect: str, canvas: tuple[int, int]) -> str:
    """Return the mandatory prompt line that requests the intended frame dimensions and ratio."""
    w, h = canvas
    orientation = "landscape" if w > h else ("portrait" if h > w else "square")
    return (f"Composition/framing: Compose for a {w}×{h} pixel frame — a {aspect} "
            f"{orientation} aspect ratio.")


class RatioError(RuntimeError):
    """The native ratio exceeds the 5% normalization tolerance (failure class 7)."""


class CodexContractError(RuntimeError):
    """A deterministic contract violation detected before a subprocess is invoked (class 1)."""


def prepare_seeds(item: dict, seeds: list[str]) -> list[str]:
    """§4.5 + §4.7: canonicalize the spec's content seeds and enforce its doctrine cap."""
    name = item.get("name", "<unnamed>")
    out = []
    for seed in seeds or []:
        supplied = os.fspath(seed)
        if not os.path.isabs(supplied):
            raise CodexContractError(
                f"{name}: seed path is not absolute: {seed!r} — codex rejects relative paths outright "
                "(AbsolutePathBuf deserialized without a base path)")
        out.append(os.path.realpath(supplied))
    if len(out) > CODEX_SEED_CAP:
        raise CodexContractError(
            f"{name}: slate carries {len(out)} seeds, over CODEX_SEED_CAP={CODEX_SEED_CAP} — "
            "refusing to truncate; re-derive the slate with forge.py batch instead")
    return out


def assert_transport_seed_ceiling(item: dict, seeds: list[str]) -> None:
    """Fail loud at the invocation boundary if referenced_image_paths exceeds Codex's ceiling.

    This is deliberately separate from ``prepare_seeds``: C15 may append its study-only register
    seed after the four content seeds have passed the §4.7 doctrine cap.
    """
    if len(seeds) > TRANSPORT_SEED_CEILING:
        name = item.get("name", "<unnamed>")
        raise CodexContractError(
            f"{name}: {len(seeds)} seeds — referenced_image_paths must contain at most "
            f"{TRANSPORT_SEED_CEILING} paths")


def seed_digests(seeds: list[str]) -> dict[str, str]:
    """Return a SHA-256 digest for each seed, for the engine log's later audit."""
    return {path: hashlib.sha256(Path(path).read_bytes()).hexdigest() for path in seeds}


def reverify_seed_digests(name: str, expected: dict[str, str]) -> None:
    """Narrow the path-based invocation TOCTOU window immediately before execution (§4.5)."""
    for path, digest in (expected or {}).items():
        actual = hashlib.sha256(Path(path).read_bytes()).hexdigest()
        if actual != digest:
            raise SeedIntegrityError(f"{name}: seed SHA-256 changed after preflight: {path}")


class CodexRunError(RuntimeError):
    """A per-item transport/provider failure; ``failure_class`` names its section-6 class."""

    def __init__(self, failure_class, message):
        super().__init__(message)
        self.failure_class = failure_class


import re  # noqa: E402
from collections.abc import Callable  # noqa: E402

# --- §4.3 idiom translation: this pipeline's STAGING idiom renders as literal signage on codex
# --- (p1 probe E2 minted a "TOTE RACK / STAGE-LEFT" sign). Ordered, word-boundary, case-insensitive.
# --- It changes WORDING only: dropping a load-bearing staging fact would be the fidelity violation
# --- named at SKILL.md L395-397.
def _frame_side(match: re.Match) -> str:
    return f"on the {match.group('side').lower()} of the frame"


IDIOM_TABLE: list[tuple[re.Pattern, str | Callable[[re.Match], str]]] = [
    (re.compile(r"\b(?:at\s+)?(?:stage|camera)[-\s](?P<side>left|right)\s+of\s+"
                r"(?:the\s+)?frame\b", re.I), _frame_side),
    (re.compile(r"\boff[-\s]?stage\b", re.I), "outside the frame"),
    (re.compile(r"\bstage[-\s](?:centre|center)\b", re.I), "centred in the frame"),
    (re.compile(r"\bstage[-\s]left\b", re.I), "on the left of the frame"),
    (re.compile(r"\bstage[-\s]right\b", re.I), "on the right of the frame"),
    (re.compile(r"\bup\s?stage\b", re.I), "toward the back of the frame"),
    (re.compile(r"\bdown\s?stage\b", re.I), "toward the front of the frame"),
    (re.compile(r"\bcamera[-\s]left\b", re.I), "on the left of the frame"),
    (re.compile(r"\bcamera[-\s]right\b", re.I), "on the right of the frame"),
]

# A quoted span is diegetic and load-bearing (SKILL.md L136-138): it must render verbatim, so the
# table is applied only to the UNQUOTED spans between them.
_QUOTED_SPAN = re.compile(r'"[^"\n]{1,60}"' r"|'[^'\n]{1,60}'")

_RESIDUAL = re.compile(r"\b(stage|wings|blocking)\b", re.I)
_DIRECTION_NEAR = re.compile(r"\b(left|right|centre|center|front|back|up|down|mark)\b", re.I)


def translate_idiom(text: str) -> str:
    """Apply IDIOM_TABLE to every unquoted span of `text`; quoted literals pass through untouched."""
    out, pos = [], 0
    for m in _QUOTED_SPAN.finditer(text or ""):
        out.append(_translate_span(text[pos:m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(_translate_span((text or "")[pos:]))
    return "".join(out)


def _translate_span(span: str) -> str:
    for pattern, replacement in IDIOM_TABLE:
        span = pattern.sub(replacement, span)
    return span


def residual_idiom(text: str) -> list[str]:
    """WARN-level scan for staging idiom the table cannot claim to cover. Never raises: the table
    is not provably exhaustive and hard-failing on authored prose would block legitimate shots."""
    translated = translate_idiom(text or "")
    hits = []
    for m in _RESIDUAL.finditer(translated):
        window = translated[max(0, m.start() - 40):m.end() + 40]
        if _DIRECTION_NEAR.search(window):
            hits.append(window.strip())
    return hits


# --- §4.1-4.3 THE COMPOSER. Codex's own labeled schema (~/.codex/skills/.system/imagegen/SKILL.md
# --- L212-229), front-loaded, ONE trailing constraint block. Gemini's two-voice head+tail
# --- convention is NOT ported: P2b E2 measured it ~4x worse on this engine.
USE_CASE = "illustration-story"
ASSET_TYPE = "documentary-style animated video still frame"
COMPOSED_CHAR_BUDGET = 2200      # P2b E1: 1740 -> 4032 chars was ~6x worse at constant facts

CODEX_REGISTER_BLOCK = {
    "Style/medium": ("clean flat 2.5D vector cartoon, even medium-thick dark warm brown-black "
                     "outline (#241a12), flat cel colour fills with gentle soft shading only, "
                     "rounded friendly shapes, no realistic detail"),
    "Color palette": ("locked 2-3 colour scene palette plus a single red accent #d7402b reserved "
                      "only for alarm / prohibition / ownership / the final punch element"),
    "Materials/textures": "flat cel fills only, no gradients, no ambient occlusion",
}

# The single biggest measured register lever (P2b B/C: 2-3x closer, and zero unrequested text in
# EVERY dedicated-Avoid run). Kept to 6 items: short, hard, direct negation, never merged into
# Constraints -- the schema splits keep/avoid deliberately.
AVOID_BASE = ["photorealism", "on-screen narrator or host face", "logos",
              "gradients and cast shadows", "soft ambient shading"]
AVOID_TEXT_WITH_QUOTES = ("unrequested text or signage beyond the quoted text and invented staging "
                          "labels")
AVOID_TEXT_NO_QUOTES = "any words, letters, numerals or signage"

CONSTRAINT_FIGURE = ("preserve {who}'s exact costume, proportions and line weight from the "
                     "reference image")
CONSTRAINT_CROWD = ("background crowd figures stay flat silhouetted shapes in the scene palette, "
                    "no individual faces and no added named characters")
CONSTRAINT_ENVIRONMENT = ("environment stays a built-but-flat environment — minimal geometry "
                          "plus one foreground depth prop, not a fully rendered set")

# Short ordinal + role label. P2b D: all three tested framings prevented style-tile content leak
# equally, INCLUDING the cheapest -- verbosity is not protective, so the composer uses the short
# form. The role words restate forge's own `role` vocabulary (seed_roles_text L1270-1352).
_ROLE_CLAUSE = {
    "figure": "character reference for {who} — match exactly",
    "canonical": "character reference for {who} — match exactly",
    "pose": "pose reference for {who} — match the body position",
    "expression": "expression reference for {who} — match the face",
    "place": "place reference — preserve its set, palette and outline weight",
    "parent": "previous frame in this chain — preserve its set, palette and outline weight",
    "prop": "prop reference — include exactly as shown",
    "crowd": "crowd reference — match its figure proportion and face style",
    "interaction": "interaction geometry reference — match the contact and eye-line",
    "style-anchor": "style reference only",
}
_ROLE_CLAUSE_DEFAULT = "reference only"

_FIGURE_ROLES = ("figure", "canonical", "pose", "expression")
_SLUG = re.compile(r"`([A-Za-z0-9][A-Za-z0-9._-]*)`")
# A diegetic literal is short and quoted (SKILL.md L136-138: 1-4 words). The single-quote form is
# guarded on both sides so a possessive apostrophe can never pair into a false literal.
_QUOTED_LITERAL = re.compile(r'"([^"\n]{1,60})"' r"|(?<![A-Za-z0-9])'([^'\n]{1,40})'(?![A-Za-z0-9])")


def resolve_slugs(text, reg):
    """Backticked slugs -> plain words, resolved from the registry so the result is deterministic."""
    assets = {a["name"]: a for a in (reg or {}).get("assets", [])}

    def one(m):
        slug = m.group(1)
        asset = assets.get(slug)
        if asset:
            tag = asset.get("tag") or slug
            kind = asset.get("kind")
            if kind == "expression":
                return f"{tag} expression"
            if kind in ("pose", "action"):
                return f"{tag} pose"
            if kind == "interaction":
                return f"{tag} interaction staging"
            return str(tag)
        return slug

    return _SLUG.sub(one, text or "")


def quoted_literals(text):
    """The in-video diegetic text, in authored order, de-duplicated."""
    out = []
    for m in _QUOTED_LITERAL.finditer(text or ""):
        lit = (m.group(1) if m.group(1) is not None else m.group(2)).strip()
        if lit and len(lit.split()) <= 4 and lit not in out:
            out.append(lit)
    return out


def input_images_line(seed_roles):
    parts = []
    for i, entry in enumerate(seed_roles or [], start=1):
        who = entry.get("character") or _stem(entry.get("path", ""))
        clause = _ROLE_CLAUSE.get(entry.get("role"), _ROLE_CLAUSE_DEFAULT).format(who=who)
        parts.append(f"Image {i}: {clause}.")
    return " ".join(parts)


def constraints_text(item):
    out, seen = [], []
    for entry in item.get("seed_roles") or []:
        who = entry.get("character")
        if entry.get("role") in _FIGURE_ROLES and who and who not in seen:
            seen.append(who)
            out.append(CONSTRAINT_FIGURE.format(who=who))
    if (item.get("figures") or {}).get("crowd"):
        out.append(CONSTRAINT_CROWD)
    out.append(CONSTRAINT_ENVIRONMENT)
    return "; ".join(out)


def avoid_text(has_quotes):
    items = (AVOID_BASE + [AVOID_TEXT_WITH_QUOTES]) if has_quotes \
        else ([AVOID_TEXT_NO_QUOTES] + AVOID_BASE)
    return ", ".join(items)


def compose_prompt(item, *, reg, canvas, aspect):
    """Pure function of (item, registry, canvas, aspect): no model call, no randomness, no ambient
    state. That is what makes --dry-run print the exact bytes a live run would send, at $0."""
    payload = translate_idiom(resolve_slugs(item.get("payload") or item.get("delta") or "", reg))
    quotes = quoted_literals(item.get("payload") or "")
    lines = [f"Use case: {USE_CASE}",
             f"Asset type: {ASSET_TYPE}",
             f"Primary request: {payload}"]
    images = input_images_line(item.get("seed_roles") or [])
    if images:
        lines.append(f"Input images: {images}")
    lines.append(f"Style/medium: {CODEX_REGISTER_BLOCK['Style/medium']}")
    lines.append(framing_line(aspect, canvas))
    lines.append(f"Color palette: {CODEX_REGISTER_BLOCK['Color palette']}")
    lines.append(f"Materials/textures: {CODEX_REGISTER_BLOCK['Materials/textures']}")
    if quotes:
        joined = "; ".join(f'"{q}"' for q in quotes)
        lines.append(f"Text (verbatim): {joined} — render exactly this text and nothing else.")
    lines.append(f"Constraints: {constraints_text(item)}")
    lines.append(f"Avoid: {avoid_text(bool(quotes))}")
    composed = "\n".join(lines) + "\n"
    residual = residual_idiom(composed)
    if residual:
        warnings.warn(f"residual staging idiom in composed prompt: {residual}",
                      RuntimeWarning, stacklevel=2)
    return composed


def resolve_codex_binary() -> str:
    """Resolve the executable at run time, failing loudly without a Codex installation.

    ``shutil.which`` deliberately provides Windows ``PATHEXT`` resolution for a codex-like binary.
    """
    exe = shutil.which(CODEX_ARGV_PREFIX[0])
    if exe is None:
        raise SystemExit(f"codex CLI not found on PATH ({CODEX_ARGV_PREFIX[0]!r}) — install it, or "
                         "patch forge_codex.CODEX_ARGV_PREFIX in tests")
    return exe


# --- §4.4 invocation. The envelope is deliberately a pointer to a persisted, UTF-8 prompt file:
# --- the model receives a mechanical pass-through instruction rather than an invitation to rewrite it.
SANDBOX_MODE = "workspace-write"

ENVELOPE_TEMPLATE = (
    "Read the file at {prompt_path} and pass its exact byte content as the `prompt` argument to "
    "`image_gen__imagegen`. Do not compose, paraphrase, normalize, or reformat this text -- read "
    "and pass through only. Call the tool exactly once, with referenced_image_paths = [{seeds}]. "
    "Do not read any file outside this directory. Report only the saved image path."
)


def build_envelope(prompt_path: str, seed_paths: list[str]) -> str:
    """Build the probe-verified file-reference instruction for one image-generation turn."""
    return ENVELOPE_TEMPLATE.format(prompt_path=prompt_path,
                                    seeds=", ".join(str(path) for path in seed_paths))


def composed_prompt_dir(staging: str) -> str:
    return os.path.join(str(staging), "_codex", "prompts")


def write_prompt_file(staging: str, name: str, text: str) -> str:
    """Persist the exact composed UTF-8 prompt as the invocation and audit artifact."""
    directory = composed_prompt_dir(staging)
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f"{name}.txt")
    with open(path, "w", encoding="utf-8", newline="") as output:
        output.write(text)
    return path


def _windows_kernel32():
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateJobObjectW.argtypes = (ctypes.c_void_p, wintypes.LPCWSTR)
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    kernel32.AssignProcessToJobObject.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
    kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel32.TerminateJobObject.argtypes = (wintypes.HANDLE, wintypes.UINT)
    kernel32.TerminateJobObject.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL
    return kernel32


def _attach_windows_job(proc) -> None:
    """Bind a just-created Windows process and later descendants to one killable Job Object."""
    kernel32 = _windows_kernel32()
    job = kernel32.CreateJobObjectW(None, None)
    if not job or not kernel32.AssignProcessToJobObject(job, proc._handle):
        if job:
            kernel32.CloseHandle(job)
        proc._codex_job = None
        return
    proc._codex_job = job


def kill_process_tree(proc) -> None:
    """Terminate a timed-out Codex process and every descendant it launched."""
    if proc.poll() is not None:
        return
    if os.name == "nt":
        job = getattr(proc, "_codex_job", None)
        if job:
            _windows_kernel32().TerminateJobObject(job, 1)
        else:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        proc.kill()


def run_codex_exec(*, envelope: str, cwd: str, timeout_s: float | None = None,
                   resume_thread: str | None = None) -> dict:
    """Run one Codex turn and return parsed stream events plus transport facts.

    Fresh and resume calls have distinct, independently measured CLI shapes. stdin remains closed
    because Codex otherwise tries to read an additional interactive prompt from it.
    """
    exe = resolve_codex_binary()
    if resume_thread:
        tail = ["exec", "resume", str(resume_thread), "--json", "--skip-git-repo-check", envelope]
    else:
        tail = ["exec", "--json", "--skip-git-repo-check", "--sandbox", SANDBOX_MODE,
                "--cd", str(cwd), envelope]
    argv = [exe] + list(CODEX_ARGV_PREFIX[1:]) + tail
    process_kwargs = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
                      if os.name == "nt" else {"start_new_session": True})
    started = time.time()
    proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, cwd=str(cwd), **process_kwargs)
    if os.name == "nt":
        # A Job Object is the reliable process-tree boundary on Windows; unlike CTRL_BREAK_EVENT
        # it does not signal this runner's shared console. The handle stays on proc until cleanup.
        _attach_windows_job(proc)
    timed_out = False
    try:
        raw, err = proc.communicate(timeout=TIMEOUT_S if timeout_s is None else timeout_s)
    except subprocess.TimeoutExpired:
        timed_out = True
        kill_process_tree(proc)
        raw, err = proc.communicate()
    stdout = (raw or b"").decode("utf-8", errors="replace")
    stderr = (err or b"").decode("utf-8", errors="replace")
    events, thread_id, usage = [], None, {}
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        events.append(event)
        if event.get("type") == "thread.started":
            thread_id = event.get("thread_id")
        elif event.get("type") == "turn.completed":
            usage = event.get("usage", {}) or {}
    result = {"events": events, "thread_id": thread_id, "usage": usage,
              "returncode": proc.returncode, "timed_out": timed_out,
              "stderr_tail": stderr.strip()[-160:], "wall_s": round(time.time() - started, 1)}
    job = getattr(proc, "_codex_job", None)
    if job:
        _windows_kernel32().CloseHandle(job)
    return result


# --- §4.6 FIDELITY AUDIT. `image_gen__imagegen` is invoked from a model-authored sandboxed JS
# --- snippet, not a native structured call, so the session rollout log is the only ground truth
# --- for what the tool actually saw. Shape-tolerant on purpose: P2b observed the prompt both as a
# --- JS string literal in `custom_tool_call.input` AND echoed in `custom_tool_call_output`.
_JS_PROMPT = re.compile(r'(?:(?:"prompt")|\bprompt)\s*:\s*("(?:[^"\\]|\\.)*")')


def rollout_path(thread_id, sessions_root=None):
    """Return the newest rollout for exactly this thread, or None when it is unavailable."""
    root = sessions_root or SESSIONS_ROOT
    if not thread_id or not os.path.isdir(root):
        return None
    filename = f"rollout-*-{glob.escape(str(thread_id))}.jsonl"
    hits = sorted(glob.glob(os.path.join(root, "*", "*", "*", filename)))
    return hits[-1] if hits else None


def _string_leaves(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from _string_leaves(value)
    elif isinstance(node, (list, tuple)):
        for value in node:
            yield from _string_leaves(value)


def extract_captured_prompt(body):
    """Return the literal prompt sent to the tool, or None when the literal is unrecoverable.

    A read-into-variable tool call has no literal prompt argument. That is the safer mechanism and
    yields an ``unverifiable`` result rather than a fidelity failure. Decode each JSONL row before
    examining its string leaves: raw JSONL escapes multi-line prompts, so raw substring searches
    falsely miss a verbatim pass-through.
    """
    for line in (body or "").splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        for leaf in _string_leaves(row):
            match = _JS_PROMPT.search(leaf)
            if match:
                try:
                    return json.loads(match.group(1))
                except json.JSONDecodeError:
                    continue
    return None


def audit_fidelity(thread_id, prompt_path, sessions_root=None):
    """Return (verified|mismatch|unverifiable, captured SHA-256 or None) read-only."""
    path = rollout_path(thread_id, sessions_root)
    if not path:
        return "unverifiable", None
    with open(path, encoding="utf-8", errors="replace") as rollout:
        captured = extract_captured_prompt(rollout.read())
    if captured is None:
        return "unverifiable", None
    with open(prompt_path, encoding="utf-8") as prompt_file:
        composed = prompt_file.read()
    sha = hashlib.sha256(captured.encode("utf-8")).hexdigest()
    return ("verified" if captured == composed else "mismatch"), sha


def count_pre_call_tool_calls(thread_id, sessions_root=None):
    """Return custom-tool-call count before image generation, or None without this thread's log."""
    path = rollout_path(thread_id, sessions_root)
    if not path:
        return None
    count = 0
    with open(path, encoding="utf-8", errors="replace") as rollout:
        for line in rollout:
            if "custom_tool_call" not in line:
                continue
            if "image_gen__imagegen" in line:
                return count
            count += 1
    return count


def snapshot_thread_dir(thread_id, image_root=None):
    """Empty for a fresh thread, non-empty for a resumed session — which is why harvest is a DIFF
    and never 'the only file in the directory'."""
    d = os.path.join(image_root or IMAGE_ROOT, str(thread_id or ""))
    return set(os.listdir(d)) if thread_id and os.path.isdir(d) else set()


def harvest_new_pngs(thread_id, before, *, image_root=None, polls=5, delay=1.0, settle_polls=2):
    """Every *.png that appeared in this thread's directory since `before`, as absolute paths.
    Bounded poll covers write/close lag after turn.completed. Counting happens here; RULING on the
    count (exactly one => success, zero => no_image, more than one => multi_emit, take none) is
    `classify_turn`'s job, so the §6 class ids live in exactly one place.
    Newest-by-mtime is explicitly rejected: 17 gens across both probe logs never produced a second
    image, so there is no evidence about what a second one MEANS. Once the first file appears,
    `settle_polls` additional polls capture a short staggered-write window."""
    root = os.fspath(Path(image_root or IMAGE_ROOT).resolve())
    d = os.path.join(root, str(thread_id or ""))
    new = []
    before = set(before)
    for attempt in range(max(1, polls)):
        now = snapshot_thread_dir(thread_id, image_root=root)
        new = sorted(n for n in (now - before) if n.lower().endswith(".png"))
        if new:
            for _ in range(max(0, settle_polls)):
                time.sleep(delay)
                now = snapshot_thread_dir(thread_id, image_root=root)
                new = sorted(n for n in (now - before) if n.lower().endswith(".png"))
            break
        if attempt + 1 < polls:
            time.sleep(delay)
    return [os.path.join(d, n) for n in new]
