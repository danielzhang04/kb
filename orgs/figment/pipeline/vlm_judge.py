#!/usr/bin/env python3
"""vlm_judge.py -- stage-2 perceptual judge for the fail-closed identity/quality gate.

`identity_gate.py`'s own 2026-09-06 calibration (95 real images, six evidence sets --
see `orgs/figment/personas/creator-001/calibration/calibration.md`) proved that facenet
cosine, a ViT age classifier, a from-scratch NIQE reimplementation, and a YCbCr gloss
proxy do NOT separate the operator's actual verdicts: Track-1 dataset cells and Qwen
anchor-edits the operator called "closer, glossy, older" score facenet identity ~0.92 --
indistinguishable from the anchors' own 0.89-0.93 pairwise cosine -- and the age
classifier itself reads the persona's own real anchor photos as ~30 years old against a
persona described as "early twenties," which is a calibration failure of the classifier,
not evidence about the generated sets. A headless Claude vision judge (`claude -p`,
subscription-billed, no API key -- see `judge_image`'s own docstring) DOES separate
them: probed on g01 vs the Track-1 LoRA tester's step-1500 checkpoint, it returned
`same_person=58, apparent_age_reference=23, apparent_age_candidate=30, skin_realism=55,
gloss=40` -- matching the operator's own "kind of close, older, glossy" verdict on that
exact image.

Persona-agnostic by construction, same convention as `identity_gate.py`: nothing in this
module names a specific creator or hardcodes an evidence-set directory. The reference
photo list always comes from whatever `persona.yaml` a caller supplies (`identity.
references`, in that file's own order -- the first entry is the operator's designated
"reference set of record" identity, everything after it is "same woman, other photos"
for context); `calibrate`'s CLI takes evidence-set directories as repeatable `--set
NAME=PATH` arguments, exactly like `identity_gate.py calibrate` does, rather than
hardcoding which directories belong to which creator's calibration run.

Two building blocks:

  * `judge_image` -- one `claude -p` call per candidate image, Reading the reference
    photo(s) and the candidate itself, returning a structured 0-100 verdict. Fail-closed:
    a judge call that never produces trustworthy JSON (a CLI crash, a timeout, a
    non-JSON or incomplete response after one retry) returns every metric as `None`
    with `unavailable["judge"]` set, never a silent pass -- see `judge_gate`, this
    module's stage-2 analogue of `identity_gate.gate()`.
  * `calibrate` -- scores named evidence-set directories (plus a leave-one-out
    self-consistency pass over the persona's own reference photos, this module's
    analogue of `identity_check.calibrate_anchors`'s anchor-pairwise numbers) and
    proposes `judge:` thresholds for `gate.yaml`, reporting honestly, per metric,
    which evidence sets the proposed threshold does and does not separate.

Every `claude` CLI call is billed to the operator's own Claude subscription through the
`claude` binary already on PATH -- never an API key (CLAUDE.md's preamble contract:
`ANTHROPIC_API_KEY` must stay unset in every fleet agent environment). `judge_image`'s
default runner never sets or forwards one.
"""
from __future__ import annotations

import argparse
import glob as glob_module
import hashlib
import json
import logging
import os
import re
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Sequence

HERE = Path(__file__).resolve().parent
DEFAULT_PERSONAS_ROOT = HERE.resolve().parents[2] / "orgs" / "figment" / "personas"
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}

DEFAULT_MODEL = "sonnet"
# 2026-09-07 fix: a live `run` over 18 1448x2176 PNGs at the old default of 4 workers
# put 4 concurrent `claude` CLIs each Reading 4 multi-MB images at once, and 16/18 rows
# timed out at the old 180s default -- see this module's own downscaling (below) and
# the 600s default timeout, both landed the same session, plus this lower worker count
# so the same host isn't asked to run more concurrent heavy CLI calls than it can.
DEFAULT_WORKERS = 2
DEFAULT_TIMEOUT = 600.0
PROMPT_VERSION = "v1"

# Every candidate/reference photo is downscaled to this longest side (JPEG, this
# quality) before the judge CLI ever Reads it -- see `_downscale_for_judge`. The
# original files stay untouched; only the copy handed to `claude -p` shrinks, which is
# what actually fixed the 4-image-Read-per-call latency that caused the 2026-09-07
# timeout incident (1448x2176, 3-4MB PNGs down to <=1024px JPEGs).
DOWNSCALE_MAX_SIDE = 1024
DOWNSCALE_JPEG_QUALITY = 92

# Emits one INFO line per call attempt (start) and per attempt outcome (finish, with
# duration) -- `main()` wires this to stderr via `logging.basicConfig` so a backgrounded
# `vlm_judge.py run ...` redirected to a file gets a live per-call progress/timing log,
# not just the final `judge.json` after the whole batch completes.
LOGGER = logging.getLogger("figment.vlm_judge")

JUDGE_THRESHOLD_KEYS = (
    "same_person_min", "age_delta_max", "skin_realism_min", "gloss_max", "artifacts_max",
)
_REQUIRED_JUDGE_FIELDS = ("same_person", "age_delta", "skin_realism", "gloss", "artifacts")
_PAYLOAD_KEYS = (
    "same_person", "apparent_age_reference", "apparent_age_candidate",
    "skin_realism", "gloss", "artifacts", "notes",
)
_DISTRIBUTION_FIELDS = (
    "same_person", "apparent_age_reference", "apparent_age_candidate", "age_delta",
    "skin_realism", "gloss", "artifacts",
)

# The handful of variables the `claude` CLI itself needs to locate its own config/auth
# and run at all -- the same short allow-list `scripts/agent_evals.py`'s own `claude -p`
# judge (`_judge_model`) already uses for its subprocess environment. Never carries
# ANTHROPIC_API_KEY or any other ambient credential.
_ENV_PASSTHROUGH = (
    "APPDATA", "COMSPEC", "HOMEDRIVE", "HOMEPATH", "HOME", "LOCALAPPDATA", "PATH",
    "PATHEXT", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR",
)


class JudgeError(RuntimeError):
    """The judge CLI could not be run, or its output could not be trusted."""


# ---------------------------------------------------------------------------
# small filesystem helpers (mirrors identity_gate.py's own -- kept local rather than
# imported so this module never depends on identity_gate.py, avoiding any risk of a
# sibling-module import cycle now that identity_gate.py imports THIS module for stage 2)
# ---------------------------------------------------------------------------


def _images_in(directory: Path) -> list[Path]:
    directory = Path(directory)
    if not directory.is_dir():
        return []
    return sorted(
        path for path in directory.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    )


def _resolve_images(patterns: list[str]) -> list[Path]:
    """Every image named by `patterns` -- each entry is either an existing directory
    (every image file directly inside it, sorted) or a glob pattern (e.g. `*.png`,
    `some/dir/**/*.jpg`) -- de-duplicated by resolved path while preserving first-seen
    order across patterns."""
    resolved: list[Path] = []
    for pattern in patterns:
        path = Path(pattern)
        if path.is_dir():
            resolved.extend(_images_in(path))
            continue
        matches = sorted(Path(p) for p in glob_module.glob(pattern, recursive=True))
        resolved.extend(
            p for p in matches if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES
        )
    seen: set[Path] = set()
    ordered: list[Path] = []
    for path in resolved:
        key = path.resolve()
        if key not in seen:
            seen.add(key)
            ordered.append(path)
    return ordered


def _clean_env() -> dict[str, str]:
    env = {name: os.environ[name] for name in _ENV_PASSTHROUGH if name in os.environ}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


# ---------------------------------------------------------------------------
# downscaling -- shrink candidate + reference photos before the judge CLI Reads them
# ---------------------------------------------------------------------------


def _sha256_file(path: str | Path) -> str | None:
    """The ORIGINAL (full-size) file's own sha256 hex digest -- `None` (never raises)
    when the file can't be read, so a caller can fall back to a resolved-path-string
    identity instead of crashing. Used both as the cache key's own ingredient (`_cache_
    key` -- deliberately keyed on file CONTENT, not the downscaled copy or the path, so
    the cache stays correct if a file is replaced at the same path, and stays
    attributable to the real evidence regardless of which downscaled copy served the
    call) and as the downscaled copy's own filename (`_downscale_for_judge`)."""
    try:
        hasher = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                hasher.update(chunk)
        return hasher.hexdigest()
    except OSError:
        return None


def _downscale_for_judge(path: Path, dest_dir: Path, *, sha256: str | None = None) -> Path:
    """A <=`DOWNSCALE_MAX_SIDE`px-longest-side JPEG (quality `DOWNSCALE_JPEG_QUALITY`)
    copy of the image at `path`, written to `dest_dir/<sha8>.jpg` where `sha8` is the
    first 8 hex chars of `path`'s OWN sha256 (`sha256`, when the caller already computed
    it for the cache key -- avoids hashing the file twice). Content-addressed on purpose:
    the same reference photo is downscaled once and reused verbatim by every candidate
    in a batch, and repeat runs over the same evidence skip re-encoding entirely.

    Never upscales -- `Image.thumbnail` only shrinks, so an already-small source is just
    re-encoded as JPEG. Written atomically (a per-thread/per-process temp file, then
    `os.replace`, which is atomic on both POSIX and Windows) so N worker threads
    downscaling the SAME shared reference photo at once can never hand the judge CLI a
    half-written file."""
    from PIL import Image

    digest = sha256 or _sha256_file(path)
    if digest is None:
        raise JudgeError(f"could not read {path} to downscale it for the judge")
    dest_dir = Path(dest_dir)
    dest = dest_dir / f"{digest[:8]}.jpg"
    if dest.is_file():
        return dest
    dest_dir.mkdir(parents=True, exist_ok=True)
    tmp = dest_dir / f".{digest[:8]}.{os.getpid()}.{threading.get_ident()}.tmp.jpg"
    with Image.open(path) as image:
        image = image.convert("RGB")
        image.thumbnail((DOWNSCALE_MAX_SIDE, DOWNSCALE_MAX_SIDE))
        image.save(tmp, format="JPEG", quality=DOWNSCALE_JPEG_QUALITY)
    os.replace(tmp, dest)
    return dest


# ---------------------------------------------------------------------------
# prompt + response parsing
# ---------------------------------------------------------------------------


def _build_prompt(candidate: Path, references: Sequence[Path]) -> str:
    reference_lines = []
    for index, reference in enumerate(references):
        role = (
            "the primary reference photo of her"
            if index == 0
            else "another real photo of the SAME woman, for context only"
        )
        reference_lines.append(f"{index + 1}. {reference} -- {role}")
    reference_block = "\n".join(reference_lines)
    return f"""You are a careful, honest visual grader for an AI image-generation identity/quality gate. You will Read some real reference photographs of one specific woman, then Read one AI-produced candidate photograph, and compare them.

First, Read these reference photo(s) of the real woman:
{reference_block}

Now Read this candidate photo, which an AI pipeline produced and which may or may not actually be the same woman, and may have realism problems:
{candidate}

Look closely and compare the candidate to the reference(s). Be skeptical, not polite -- a resemblance is not the same as being the same person, and smooth/plastic/glossy skin is a real defect even if the pose and lighting look nice.

Respond with ONLY a single JSON object, no markdown code fence, no other text, with exactly these keys:
{{
  "same_person": <integer 0-100, 100 = certainly the same woman as the reference photo(s), 0 = certainly a different woman>,
  "apparent_age_reference": <integer, your best-guess age in years of the woman in the reference photo(s)>,
  "apparent_age_candidate": <integer, your best-guess age in years of the woman in the candidate photo>,
  "skin_realism": <integer 0-100, 100 = skin looks like an unretouched real phone photo with natural pores/texture, 0 = obviously plastic/waxy/over-smoothed/airbrushed AI skin>,
  "gloss": <integer 0-100, how much specular shine / wet-look sheen the skin has, 0 = matte real skin, 100 = extremely glossy/oily-looking>,
  "artifacts": <integer 0-100, how visibly wrong the anatomy/hands/hair/eyeliner/eyes are, 0 = flawless, 100 = severely broken>,
  "notes": "<15 words or fewer, your honest one-line impression>"
}}"""


_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def _extract_json_object(text: str) -> dict[str, Any] | None:
    """Best-effort extraction of a single JSON object from a model's raw text answer:
    tries the whole text first, then the inside of a ```json fence if one is present,
    then falls back to the first balanced `{...}` block found anywhere in the text (a
    model that ignores the "ONLY JSON" instruction and adds a sentence before/after it
    should still be usable). Returns `None`, never raises, when nothing parses."""
    if not text:
        return None
    candidates = [text]
    fence_match = _JSON_FENCE_RE.search(text)
    if fence_match:
        candidates.insert(0, fence_match.group(1))
    for candidate in candidates:
        candidate = candidate.strip()
        try:
            parsed = json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            parsed = None
        if isinstance(parsed, dict):
            return parsed
        start = candidate.find("{")
        if start == -1:
            continue
        depth = 0
        for index in range(start, len(candidate)):
            char = candidate[index]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    snippet = candidate[start:index + 1]
                    try:
                        parsed = json.loads(snippet)
                    except (json.JSONDecodeError, ValueError):
                        parsed = None
                    if isinstance(parsed, dict):
                        return parsed
                    break
    return None


def _coerce_judge_payload(payload: Any) -> dict[str, Any] | None:
    """Validate + coerce a parsed JSON object into the judge's own field contract.
    `None` (never raises) when any required key is missing or not numeric/stringy --
    the caller treats that exactly like a non-JSON response (retry once, then fail
    closed)."""
    if not isinstance(payload, dict):
        return None
    try:
        same_person = int(round(float(payload["same_person"])))
        apparent_age_reference = int(round(float(payload["apparent_age_reference"])))
        apparent_age_candidate = int(round(float(payload["apparent_age_candidate"])))
        skin_realism = int(round(float(payload["skin_realism"])))
        gloss = int(round(float(payload["gloss"])))
        artifacts = int(round(float(payload["artifacts"])))
        notes = payload["notes"]
    except (KeyError, TypeError, ValueError):
        return None
    if not isinstance(notes, str):
        return None
    return {
        "same_person": same_person,
        "apparent_age_reference": apparent_age_reference,
        "apparent_age_candidate": apparent_age_candidate,
        "age_delta": apparent_age_candidate - apparent_age_reference,
        "skin_realism": skin_realism,
        "gloss": gloss,
        "artifacts": artifacts,
        "notes": notes.strip(),
    }


def parse_cli_envelope(raw: str) -> dict[str, Any] | None:
    """Parse the `claude -p --output-format json` envelope -- a single JSON object on
    stdout carrying (among other fields) a `result` string with the model's final text.
    `None` when `raw` is not a parseable JSON object at all (a crashed/garbled CLI
    invocation); a parseable envelope whose OWN `result` text is not itself valid JSON
    is the caller's problem (triggers the same retry-once-then-fail-closed path), not
    this function's."""
    if not raw:
        return None
    try:
        envelope = json.loads(raw.strip())
    except (json.JSONDecodeError, ValueError):
        return None
    return envelope if isinstance(envelope, dict) else None


# ---------------------------------------------------------------------------
# the real, subscription-billed CLI call -- every test injects a fake `runner` instead
# ---------------------------------------------------------------------------


def _default_runner(prompt: str, *, model: str, timeout: float = DEFAULT_TIMEOUT) -> str:
    """Matches the operator-verified probe command exactly: the prompt goes on STDIN
    (never argv -- these prompts embed absolute file paths and could be long),
    `--output-format json` (a parseable envelope, not prose), `--permission-mode
    bypassPermissions` + `--allowedTools "Read"` (the judge only ever needs to Read the
    reference/candidate image files, nothing else -- never Write/Edit/Bash). Runs from a
    fresh scratch directory, never this repo's own working tree, so the model never
    loads this repo's own CLAUDE.md/AGENTS.md into a grading call and can never write
    into the repo even by accident. Subscription-billed through the `claude` binary
    already on PATH -- `_clean_env()` never forwards `ANTHROPIC_API_KEY` or any other
    ambient credential (CLAUDE.md's preamble contract: fleet agents never hold one)."""
    cmd = [
        "claude", "-p", "--model", model, "--output-format", "json",
        "--permission-mode", "bypassPermissions", "--allowedTools", "Read",
    ]
    # `ignore_cleanup_errors=True` (Python 3.10+): on Windows, `claude` (a Node CLI)
    # can leave the scratch directory momentarily locked by a just-exited child process
    # even after `subprocess.run` itself has returned -- observed live during this
    # module's own first real calibration run, where a bare `TemporaryDirectory()`
    # raised `PermissionError` on `__exit__` and corrupted an otherwise-successful
    # judgement into a spurious retry. A rmdir that fails here is not this function's
    # problem to solve; the OS temp-cleaner reclaims it eventually.
    with tempfile.TemporaryDirectory(prefix="kb-figment-judge-", ignore_cleanup_errors=True) as scratch:
        try:
            result = subprocess.run(
                cmd, cwd=scratch, input=prompt, capture_output=True, text=True,
                timeout=timeout, env=_clean_env(),
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise JudgeError(f"judge CLI failed to run: {exc}") from exc
    if result.returncode != 0:
        raise JudgeError(
            f"judge CLI exited {result.returncode}: {(result.stderr or '').strip()[:400]}"
        )
    return result.stdout


# ---------------------------------------------------------------------------
# judge_image -- the per-image contract function
# ---------------------------------------------------------------------------


def _cache_key(
    candidate_sha: str | None, reference_shas: Sequence[str | None], *,
    candidate: Path, references: Sequence[Path], model: str, prompt_version: str,
) -> str:
    """Keyed on the ORIGINAL candidate's own sha256 + the ORIGINAL references' own
    sha256s + model + prompt_version -- content, not path, so results stay attributable
    to the real evidence regardless of which downscaled copy actually served the CLI
    call (`_downscale_for_judge`), and so replacing a file's content at the same path
    correctly busts the cache. Falls back to the resolved path string per-image ONLY
    when that one file's sha256 couldn't be computed (`_sha256_file` returned `None`,
    e.g. an unreadable file) -- degraded but never crashes the cache lookup."""
    payload = json.dumps(
        {
            "candidate": candidate_sha or str(Path(candidate).resolve()),
            "references": [
                sha or str(Path(reference).resolve())
                for sha, reference in zip(reference_shas, references)
            ],
            "model": model,
            "prompt_version": prompt_version,
        },
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _fail_result(
    image_id: str, reason: str, *, model: str, duration_s: float,
    judged_from: str | None = None,
) -> dict[str, Any]:
    return {
        "image_id": image_id,
        "same_person": None, "apparent_age_reference": None, "apparent_age_candidate": None,
        "age_delta": None, "skin_realism": None, "gloss": None, "artifacts": None,
        "notes": None,
        "model": model, "duration_s": duration_s, "cost_usd": None, "cache_hit": False,
        "judged_from": judged_from,
        "unavailable": {"judge": reason},
    }


def judge_image(
    candidate: str | Path,
    references: Sequence[str | Path],
    *,
    model: str = DEFAULT_MODEL,
    runner: Callable[..., str] | None = None,
    cache_dir: str | Path | None = None,
    prompt_version: str = PROMPT_VERSION,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """One `claude -p` call judging `candidate` against `references` (in the given
    order -- the persona's own `identity.references[0]` first, everything after it
    described to the model as "same woman, other photos"). Never raises: every failure
    mode (no references given, the CLI crashing, a non-JSON or incomplete response even
    after one retry) degrades to a fail-closed result with every metric `None` and
    `unavailable["judge"]` set -- see `judge_gate`, which turns that into the single
    reason `"unavailable: judge"`, never a silent pass.

    `cache_dir`, when given, caches the full result keyed by a sha256 of
    `(candidate, references, model, prompt_version)` -- content-addressed on the
    ORIGINAL files, see `_cache_key` -- under `<cache_dir>/<hash>.json`, so a repeat
    `calibrate`/`run` invocation over the same evidence never re-spends a subscription
    call. 2026-09-07 fix: ONLY a result with a parsed numeric `same_person` (i.e. a real
    judgement, never `unavailable["judge"]`) is ever written to the cache -- a timed-out
    or otherwise-failed call is retried for real on the next invocation, not served
    forever as a false `cache_hit`. On load, a cache entry that predates this fix (no
    parsed `same_person`) is treated as a MISS the same way, healing the existing bad
    entries in place the first time each is looked up again. Delete the cache directory
    to force a fresh judgement of everything regardless.

    Before the CLI call, both `candidate` and every one of `references` are downscaled
    (`_downscale_for_judge` -- longest side `DOWNSCALE_MAX_SIDE`px, JPEG quality
    `DOWNSCALE_JPEG_QUALITY`) and those SMALLER copies are what the prompt actually
    points the judge at; the cache key itself stays keyed on the ORIGINAL, full-size
    files so results remain attributable to the real evidence. The downscaled candidate
    path actually used is recorded on the row as `judged_from`.
    """
    # Resolved to ABSOLUTE paths up front: the prompt embeds these paths verbatim for
    # the judge to Read, and `_default_runner` deliberately runs from a scratch
    # directory (never this repo's own working tree, see its own docstring) -- a
    # relative path would resolve against that unrelated scratch cwd and simply not
    # exist, which is exactly what a real run surfaced before this fix.
    candidate = Path(candidate).resolve()
    references = [Path(reference).resolve() for reference in references]
    image_id = candidate.stem
    runner = runner or _default_runner

    candidate_sha = _sha256_file(candidate)
    reference_shas = [_sha256_file(reference) for reference in references]

    cache_path: Path | None = None
    if cache_dir is not None:
        key = _cache_key(
            candidate_sha, reference_shas, candidate=candidate, references=references,
            model=model, prompt_version=prompt_version,
        )
        cache_path = Path(cache_dir) / f"{key}.json"
        if cache_path.is_file():
            try:
                cached = json.loads(cache_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                cached = None
            if isinstance(cached, dict) and cached.get("same_person") is not None:
                cached = dict(cached)
                cached["image_id"] = image_id
                cached["cache_hit"] = True
                return cached
            # else: no cache entry, or a legacy/failed one with no parsed
            # `same_person` -- treat as a miss and re-judge for real below.

    if not references:
        result = _fail_result(
            image_id, "no reference images given", model=model, duration_s=0.0,
        )
    else:
        downscale_dir = (
            Path(cache_dir).parent / "judge-inputs" if cache_dir is not None
            else Path(tempfile.gettempdir()) / "kb-figment-judge-inputs"
        )
        try:
            judged_candidate = _downscale_for_judge(candidate, downscale_dir, sha256=candidate_sha)
            judged_references = [
                _downscale_for_judge(reference, downscale_dir, sha256=sha)
                for reference, sha in zip(references, reference_shas)
            ]
        except Exception as exc:  # noqa: BLE001 - never let a downscale failure block judging
            LOGGER.warning("judge %s: downscaling failed (%s), judging originals", image_id, exc)
            judged_candidate, judged_references = candidate, references
        judged_from = str(judged_candidate)

        prompt = _build_prompt(judged_candidate, judged_references)
        result = None
        last_reason = "unknown failure"
        duration = 0.0
        for attempt in range(2):
            start = time.perf_counter()
            LOGGER.info(
                "judge start id=%s attempt=%d/2 model=%s timeout=%.0fs",
                image_id, attempt + 1, model, timeout,
            )
            try:
                raw = runner(prompt, model=model, timeout=timeout)
            except Exception as exc:  # noqa: BLE001 - fail-closed, never crash the caller
                duration = time.perf_counter() - start
                last_reason = f"{type(exc).__name__}: {exc}"
                LOGGER.info(
                    "judge finish id=%s attempt=%d/2 duration_s=%.1f result=error (%s)",
                    image_id, attempt + 1, duration, last_reason,
                )
                continue
            duration = time.perf_counter() - start
            envelope = parse_cli_envelope(raw)
            if envelope is None:
                last_reason = f"judge CLI did not return a parseable JSON envelope: {raw[:200]!r}"
                LOGGER.info(
                    "judge finish id=%s attempt=%d/2 duration_s=%.1f result=unparseable",
                    image_id, attempt + 1, duration,
                )
                continue
            if envelope.get("is_error"):
                last_reason = f"judge CLI reported an error: {str(envelope.get('result'))[:200]}"
                LOGGER.info(
                    "judge finish id=%s attempt=%d/2 duration_s=%.1f result=cli-error",
                    image_id, attempt + 1, duration,
                )
                continue
            payload = _extract_json_object(str(envelope.get("result") or ""))
            coerced = _coerce_judge_payload(payload) if payload is not None else None
            if coerced is None:
                last_reason = (
                    f"judge did not return parseable JSON in its result: "
                    f"{str(envelope.get('result'))[:200]!r}"
                )
                LOGGER.info(
                    "judge finish id=%s attempt=%d/2 duration_s=%.1f result=bad-json",
                    image_id, attempt + 1, duration,
                )
                continue
            cost = envelope.get("total_cost_usd")
            if not isinstance(cost, (int, float)):
                raw_cost = envelope.get("cost_usd")
                cost = raw_cost if isinstance(raw_cost, (int, float)) else None
            result = {
                "image_id": image_id,
                **coerced,
                "model": model,
                "duration_s": duration,
                "cost_usd": cost,
                "cache_hit": False,
                "judged_from": judged_from,
                "unavailable": {},
            }
            LOGGER.info(
                "judge finish id=%s attempt=%d/2 duration_s=%.1f result=ok same_person=%s",
                image_id, attempt + 1, duration, coerced["same_person"],
            )
            break
        if result is None:
            result = _fail_result(
                image_id, last_reason, model=model, duration_s=duration, judged_from=judged_from,
            )

    if cache_path is not None and result.get("same_person") is not None:
        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(
                json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8",
            )
        except OSError:
            pass
    return result


def judge_images_for_stage(
    images: list[dict[str, Any]],
    references: Sequence[str | Path],
    *,
    model: str = DEFAULT_MODEL,
    runner: Callable[..., str] | None = None,
    cache_dir: str | Path | None = None,
    workers: int = DEFAULT_WORKERS,
    prompt_version: str = PROMPT_VERSION,
    timeout: float = DEFAULT_TIMEOUT,
) -> list[dict[str, Any]]:
    """Judge every one of `images` (`{"image_id":..., "path":...}` rows, matching
    `identity_gate.score_cells_for_stage`'s own row shape) against the SAME fixed
    `references` list, in parallel via a thread pool (`workers`, default 4 -- each call
    is an I/O-bound subprocess, not CPU-bound work, so threads are the right primitive).
    Return order matches `images`' own order regardless of completion order."""
    if not images:
        return []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = [
            pool.submit(
                judge_image, item["path"], references, model=model, runner=runner,
                cache_dir=cache_dir, prompt_version=prompt_version, timeout=timeout,
            )
            for item in images
        ]
        rows = [future.result() for future in futures]
    for item, row in zip(images, rows):
        row["image_id"] = item.get("image_id", row["image_id"])
    return rows


# ---------------------------------------------------------------------------
# judge_gate -- stage 2 of the two-stage fail-closed gate
# ---------------------------------------------------------------------------


def judge_gate(row: dict[str, Any] | None, thresholds: dict[str, Any]) -> dict[str, Any]:
    """Stage 2 of the two-stage identity/quality gate (see `identity_gate.
    identity_floor_gate` for stage 1, `identity_gate.two_stage_gate` for how the two
    combine). Fail-closed exactly like `identity_gate.gate()`: a row that never
    produced a trustworthy judgement (`row is None`, or ANY of its five required
    fields is `None` -- `judge_image`'s own fail-closed contract) fails with the
    single reason `"unavailable: judge"` -- never a per-field reason, because one CLI
    call either produces every field together or none of them. A present threshold
    key missing from `thresholds` fails closed too (`"unavailable: <key>"`), same
    convention as `identity_gate.gate()`."""
    if row is None or any(row.get(field) is None for field in _REQUIRED_JUDGE_FIELDS):
        return {"pass": False, "reasons": ["unavailable: judge"]}

    reasons: list[str] = []

    def _floor(metric: str, key: str, value: float) -> None:
        limit = thresholds.get(key)
        if limit is None:
            reasons.append(f"unavailable: {key}")
            return
        if value < limit:
            reasons.append(f"{metric} {value:.4g} is below the required floor {limit:.4g}")

    def _ceiling(metric: str, key: str, value: float, *, absolute: bool = False) -> None:
        limit = thresholds.get(key)
        if limit is None:
            reasons.append(f"unavailable: {key}")
            return
        measured = abs(value) if absolute else value
        if measured > limit:
            label = f"|{metric}|" if absolute else metric
            reasons.append(f"{label} {measured:.4g} exceeds the allowed ceiling {limit:.4g}")

    _floor("same_person", "same_person_min", row["same_person"])
    _ceiling("age_delta", "age_delta_max", row["age_delta"], absolute=True)
    _floor("skin_realism", "skin_realism_min", row["skin_realism"])
    _ceiling("gloss", "gloss_max", row["gloss"])
    _ceiling("artifacts", "artifacts_max", row["artifacts"])
    return {"pass": not reasons, "reasons": reasons}


# ---------------------------------------------------------------------------
# calibrate -- propose judge: thresholds from real evidence sets
# ---------------------------------------------------------------------------


def _distribution(values: list[Any]) -> dict[str, float | int | None]:
    clean = [float(value) for value in values if isinstance(value, (int, float))]
    if not clean:
        return {"n": 0, "min": None, "p5": None, "median": None, "p95": None, "max": None}
    ordered = sorted(clean)
    n = len(ordered)

    def _percentile(fraction: float) -> float:
        if n == 1:
            return ordered[0]
        index = fraction * (n - 1)
        low, high = int(index), min(int(index) + 1, n - 1)
        weight = index - low
        return ordered[low] * (1 - weight) + ordered[high] * weight

    return {
        "n": n, "min": ordered[0], "p5": _percentile(0.05),
        "median": float(statistics.median(ordered)), "p95": _percentile(0.95), "max": ordered[-1],
    }


def _anchor_self_consistency_rows(
    references: list[Path], **judge_kwargs: Any,
) -> list[dict[str, Any]]:
    """This module's analogue of `identity_check.calibrate_anchors`'s anchor-pairwise
    numbers: judge each reference photo as a "candidate" against the OTHER reference
    photos only -- NEVER against itself, which would be a trivial `same_person=100` by
    construction and would tell us nothing about the judge's real self-consistency on
    the persona's own genuine, unedited photographs."""
    rows = []
    for index, reference in enumerate(references):
        others = [other for other_index, other in enumerate(references) if other_index != index]
        if not others:
            continue
        row = judge_image(reference, others, **judge_kwargs)
        row["image_id"] = Path(reference).stem
        rows.append(row)
    return rows


def _propose_ceiling(
    anchor_values: list[float], other_sets: dict[str, list[float]], *, buffer_factor: float = 1.5,
) -> tuple[float | None, str]:
    """A ceiling proposal for a "higher is worse" judge metric (age_delta -- already
    absolute-valued by the caller --, gloss, artifacts): `buffer_factor` times the
    anchor set's own worst (max) self-consistency value. Reports, per other set,
    whether that set's median sits above the proposed ceiling (a real separation) or
    not, said honestly either way -- mirrors `identity_gate._propose_ceiling`'s shape
    but is not imported from it, keeping this module free of any dependency on
    `identity_gate.py` (which imports THIS module for stage 2 -- see that module's
    `two_stage_gate`)."""
    clean_anchor = [value for value in anchor_values if value is not None]
    if not clean_anchor:
        return None, "no anchor self-consistency values available; cannot propose a ceiling"
    base = max(clean_anchor)
    proposed = round(base * buffer_factor, 4) if base > 0 else round(base + 1.0, 4)
    notes = [f"anchor self-consistency max {base:.4f} x{buffer_factor} buffer = {proposed:.4f}"]
    for name, values in other_sets.items():
        clean = [value for value in values if value is not None]
        if not clean:
            notes.append(f"{name}: no values")
            continue
        median = statistics.median(clean)
        separates = median > proposed
        notes.append(
            f"{name} median {median:.4f} {'>' if separates else '<='} proposed ceiling "
            f"({'separates' if separates else 'does NOT separate'})"
        )
    return proposed, "; ".join(notes)


def _propose_floor(
    anchor_values: list[float], other_sets: dict[str, list[float]], *, buffer_factor: float = 0.9,
) -> tuple[float | None, str]:
    """A floor proposal for a "higher is better" judge metric (same_person,
    skin_realism): `buffer_factor` times the anchor set's own worst (min) self-
    consistency value -- the mirror image of `_propose_ceiling`. Reports, per other
    set, whether that set's median sits below the proposed floor (a real separation)."""
    clean_anchor = [value for value in anchor_values if value is not None]
    if not clean_anchor:
        return None, "no anchor self-consistency values available; cannot propose a floor"
    base = min(clean_anchor)
    proposed = round(base * buffer_factor, 4)
    notes = [f"anchor self-consistency min {base:.4f} x{buffer_factor} buffer = {proposed:.4f}"]
    for name, values in other_sets.items():
        clean = [value for value in values if value is not None]
        if not clean:
            notes.append(f"{name}: no values")
            continue
        median = statistics.median(clean)
        separates = median < proposed
        notes.append(
            f"{name} median {median:.4f} {'<' if separates else '>='} proposed floor "
            f"({'separates' if separates else 'does NOT separate'})"
        )
    return proposed, "; ".join(notes)


def calibrate(
    persona: dict[str, Any],
    sets: dict[str, Path],
    *,
    model: str = DEFAULT_MODEL,
    runner: Callable[..., str] | None = None,
    cache_dir: str | Path | None = None,
    workers: int = DEFAULT_WORKERS,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Judge every image in every one of `sets` (name -> directory) against
    `persona.identity.references` (the FIXED reference list, in persona order -- the
    same list every real gate run uses), plus a leave-one-out self-consistency pass
    over the references themselves (the "anchors" evidence), propose `judge:`
    thresholds from the resulting distributions, and report -- honestly -- which
    metrics do and do not separate each set's operator verdict. Nothing here is
    specific to any one persona: both `persona` and `sets` are supplied by the caller
    (see this module's `main()` for how the CLI builds them from `--creator`/`--set`,
    exactly like `identity_gate.py calibrate` does)."""
    persona_dir = (
        Path(persona["_persona_path"]).resolve().parent if persona.get("_persona_path") else None
    )
    references = persona["identity"]["references"]
    reference_paths = [
        (persona_dir / reference).resolve() if persona_dir else Path(reference)
        for reference in references
    ]
    judge_kwargs = dict(model=model, runner=runner, cache_dir=cache_dir, timeout=timeout)

    result_sets: dict[str, Any] = {}
    anchor_rows = _anchor_self_consistency_rows(reference_paths, **judge_kwargs)
    result_sets["anchors"] = {
        "n": len(anchor_rows), "rows": anchor_rows,
        "distributions": {
            field: _distribution([row.get(field) for row in anchor_rows])
            for field in _DISTRIBUTION_FIELDS
        },
    }

    for name, directory in sets.items():
        paths = _images_in(Path(directory))
        images = [{"image_id": path.stem, "path": str(path)} for path in paths]
        rows = judge_images_for_stage(images, reference_paths, workers=workers, **judge_kwargs)
        result_sets[name] = {
            "n": len(rows), "rows": rows,
            "distributions": {
                field: _distribution([row.get(field) for row in rows])
                for field in _DISTRIBUTION_FIELDS
            },
        }

    def _field_values(name_filter: Callable[[str], bool], field: str, *, absolute: bool = False) -> list[float]:
        values = [
            row.get(field)
            for name, data in result_sets.items() if name_filter(name)
            for row in data["rows"]
        ]
        clean = [value for value in values if isinstance(value, (int, float))]
        return [abs(value) for value in clean] if absolute else clean

    def _other_sets(field: str, *, absolute: bool = False) -> dict[str, list[float]]:
        result = {}
        for name, data in result_sets.items():
            if name == "anchors":
                continue
            values = [row.get(field) for row in data["rows"]]
            clean = [value for value in values if isinstance(value, (int, float))]
            result[name] = [abs(value) for value in clean] if absolute else clean
        return result

    same_person_min, same_person_note = _propose_floor(
        _field_values(lambda name: name == "anchors", "same_person"), _other_sets("same_person"),
    )
    # age_delta ceiling is proposed and checked on |age_delta| throughout -- unlike
    # identity_gate.py's own age_delta_max_years (proposed from raw, signed values but
    # CHECKED against abs() in gate() -- a latent inconsistency there), this module
    # takes abs() before EVERY statistic so the proposal and the check agree.
    age_delta_max, age_delta_note = _propose_ceiling(
        _field_values(lambda name: name == "anchors", "age_delta", absolute=True),
        _other_sets("age_delta", absolute=True),
    )
    skin_realism_min, skin_realism_note = _propose_floor(
        _field_values(lambda name: name == "anchors", "skin_realism"), _other_sets("skin_realism"),
    )
    gloss_max, gloss_note = _propose_ceiling(
        _field_values(lambda name: name == "anchors", "gloss"), _other_sets("gloss"),
    )
    artifacts_max, artifacts_note = _propose_ceiling(
        _field_values(lambda name: name == "anchors", "artifacts"), _other_sets("artifacts"),
    )

    proposed_thresholds = {
        "same_person_min": same_person_min,
        "age_delta_max": age_delta_max,
        "skin_realism_min": skin_realism_min,
        "gloss_max": gloss_max,
        "artifacts_max": artifacts_max,
    }
    separability = {
        "same_person_min": same_person_note,
        "age_delta_max": age_delta_note,
        "skin_realism_min": skin_realism_note,
        "gloss_max": gloss_note,
        "artifacts_max": artifacts_note,
    }

    pass_fraction: dict[str, float | None] = {}
    for name, data in result_sets.items():
        verdicts = [judge_gate(row, proposed_thresholds) for row in data["rows"]]
        data["pass_count_preview"] = sum(1 for verdict in verdicts if verdict["pass"])
        pass_fraction[name] = (data["pass_count_preview"] / data["n"]) if data["n"] else None

    all_rows = [row for data in result_sets.values() for row in data["rows"]]
    total_duration_s = sum(row.get("duration_s") or 0.0 for row in all_rows)
    total_cost_usd = sum(
        row.get("cost_usd") for row in all_rows if isinstance(row.get("cost_usd"), (int, float))
    )

    return {
        "schema": "figment/judge-calibration@1",
        "creator": persona.get("id"),
        "model": model,
        "prompt_version": PROMPT_VERSION,
        "references": [str(path) for path in reference_paths],
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "sets": result_sets,
        "proposed_thresholds": proposed_thresholds,
        "separability": separability,
        "pass_fraction": pass_fraction,
        "total_images": len(all_rows),
        "total_duration_s": total_duration_s,
        "total_cost_usd": total_cost_usd,
    }


def _render_calibration_md(calibration: dict[str, Any]) -> str:
    lines = [
        f"# vlm_judge calibration -- {calibration.get('creator')}",
        "",
        f"generated: {calibration['generated_utc']}",
        f"model: `{calibration['model']}` · prompt version: `{calibration['prompt_version']}`",
        f"total images judged: {calibration['total_images']} · "
        f"wall time: {calibration['total_duration_s']:.1f}s · "
        f"reported cost: ${calibration['total_cost_usd']:.4f}",
        "",
        "## Per-set distributions",
        "",
    ]
    for name, data in calibration["sets"].items():
        pass_fraction = calibration["pass_fraction"].get(name)
        pass_text = f"{pass_fraction:.0%}" if pass_fraction is not None else "n/a"
        lines.append(
            f"### {name} (n={data['n']}, pass under proposed thresholds: "
            f"{data['pass_count_preview']}/{data['n']} = {pass_text})"
        )
        lines.append("")
        lines.append("| metric | n | min | p5 | median | p95 | max |")
        lines.append("|---|---|---|---|---|---|---|")
        for field, dist in data["distributions"].items():
            def _fmt(value):
                return f"{value:.4f}" if isinstance(value, float) else ("n/a" if value is None else str(value))
            lines.append(
                f"| {field} | {dist['n']} | {_fmt(dist['min'])} | {_fmt(dist['p5'])} | "
                f"{_fmt(dist['median'])} | {_fmt(dist['p95'])} | {_fmt(dist['max'])} |"
            )
        lines.append("")
    lines += ["## Proposed thresholds", ""]
    for key, value in calibration["proposed_thresholds"].items():
        lines.append(f"- `{key}`: {value}")
        lines.append(f"  - separability: {calibration['separability'][key]}")
    return "\n".join(lines) + "\n"


def run_calibrate(
    creator_id: str,
    sets: dict[str, Path],
    out: Path,
    *,
    personas_root: Path,
    model: str = DEFAULT_MODEL,
    workers: int = DEFAULT_WORKERS,
    timeout: float = DEFAULT_TIMEOUT,
    runner: Callable[..., str] | None = None,
) -> dict[str, str]:
    persona_path = Path(personas_root) / creator_id / "persona.yaml"
    persona = json.loads(persona_path.read_text(encoding="utf-8"))
    persona["_persona_path"] = str(persona_path)
    out = Path(out)
    calibration = calibrate(
        persona, sets, model=model, runner=runner, cache_dir=out / "judge-cache", workers=workers,
        timeout=timeout,
    )
    out.mkdir(parents=True, exist_ok=True)
    json_path = out / "judge-calibration.json"
    md_path = out / "judge-calibration.md"
    json_path.write_text(json.dumps(calibration, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(_render_calibration_md(calibration), encoding="utf-8")
    return {"json": str(json_path), "md": str(md_path)}


# ---------------------------------------------------------------------------
# run -- judge an arbitrary directory/glob of images against one persona's references
# ---------------------------------------------------------------------------


def run_judge(
    creator_id: str,
    image_patterns: list[str],
    out: Path,
    *,
    personas_root: Path,
    model: str = DEFAULT_MODEL,
    workers: int = DEFAULT_WORKERS,
    timeout: float = DEFAULT_TIMEOUT,
    runner: Callable[..., str] | None = None,
) -> dict[str, str]:
    persona_path = Path(personas_root) / creator_id / "persona.yaml"
    persona = json.loads(persona_path.read_text(encoding="utf-8"))
    persona_dir = persona_path.parent
    references = [(persona_dir / reference).resolve() for reference in persona["identity"]["references"]]
    paths = _resolve_images(image_patterns)
    if not paths:
        raise JudgeError(f"no images matched {image_patterns!r}")
    images = [{"image_id": path.stem, "path": str(path)} for path in paths]
    out = Path(out)
    start = time.time()
    rows = judge_images_for_stage(
        images, references, model=model, runner=runner, cache_dir=out / "judge-cache",
        workers=workers, timeout=timeout,
    )
    elapsed = time.time() - start
    document = {
        "schema": "figment/judge@1",
        "creator": creator_id,
        "model": model,
        "prompt_version": PROMPT_VERSION,
        "references": [str(reference) for reference in references],
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "rows": rows,
        "summary": {
            "total": len(rows),
            "available": sum(1 for row in rows if not row.get("unavailable")),
            "unavailable": sum(1 for row in rows if row.get("unavailable")),
            "elapsed_s": elapsed,
            "total_cost_usd": sum(
                row.get("cost_usd") for row in rows if isinstance(row.get("cost_usd"), (int, float))
            ),
        },
    }
    out.mkdir(parents=True, exist_ok=True)
    json_path = out / "judge.json"
    json_path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"json": str(json_path)}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_set_arg(value: str) -> tuple[str, str]:
    if "=" not in value:
        raise argparse.ArgumentTypeError(f"--set must be NAME=PATH, got {value!r}")
    name, _, path = value.partition("=")
    if not name or not path:
        raise argparse.ArgumentTypeError(f"--set must be NAME=PATH, got {value!r}")
    return name, path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    run_parser = commands.add_parser(
        "run", help="judge a set of images against one persona's reference photos",
    )
    run_parser.add_argument("--creator", required=True)
    run_parser.add_argument(
        "--images", dest="images", action="append", required=True,
        help="a directory or glob pattern, repeatable",
    )
    run_parser.add_argument("--out", required=True, type=Path)
    run_parser.add_argument("--model", default=DEFAULT_MODEL)
    run_parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    run_parser.add_argument(
        "--call-timeout", dest="timeout", type=float, default=DEFAULT_TIMEOUT,
        help=f"per-`claude` CLI call timeout in seconds (default: {DEFAULT_TIMEOUT:.0f})",
    )
    run_parser.add_argument("--personas-root", type=Path, default=DEFAULT_PERSONAS_ROOT)

    calibrate_parser = commands.add_parser(
        "calibrate", help="score named evidence sets and propose judge: thresholds",
    )
    calibrate_parser.add_argument("--creator", required=True)
    calibrate_parser.add_argument("--out", required=True, type=Path)
    calibrate_parser.add_argument("--model", default=DEFAULT_MODEL)
    calibrate_parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    calibrate_parser.add_argument(
        "--call-timeout", dest="timeout", type=float, default=DEFAULT_TIMEOUT,
        help=f"per-`claude` CLI call timeout in seconds (default: {DEFAULT_TIMEOUT:.0f})",
    )
    calibrate_parser.add_argument("--personas-root", type=Path, default=DEFAULT_PERSONAS_ROOT)
    calibrate_parser.add_argument(
        "--set", dest="sets", action="append", type=_parse_set_arg, default=[],
        help="NAME=PATH, repeatable; an 'anchors' leave-one-out set is always added "
             "automatically from the persona's own identity.references",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    # A per-call start/finish line (see `judge_image`'s own LOGGER.info calls) on
    # stderr -- a backgrounded `vlm_judge.py run ...` redirected to a file gets a live
    # progress/timing log while the batch is still running, not just the final
    # `judge.json` once every image is done. No-ops if a caller already configured
    # logging (e.g. a test importing this module) -- `basicConfig` only installs a
    # handler when the root logger doesn't have one yet.
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = build_parser().parse_args(list(sys.argv[1:] if argv is None else argv))
    try:
        if args.command == "run":
            result = run_judge(
                args.creator, args.images, args.out, personas_root=args.personas_root,
                model=args.model, workers=args.workers, timeout=args.timeout,
            )
            print(f"judge written: {result['json']}")
            return 0
        if args.command == "calibrate":
            sets = {name: Path(path) for name, path in args.sets}
            start = time.time()
            result = run_calibrate(
                args.creator, sets, args.out, personas_root=args.personas_root,
                model=args.model, workers=args.workers, timeout=args.timeout,
            )
            elapsed = time.time() - start
            print(f"calibration written: {result['json']}")
            print(f"calibration written: {result['md']}")
            print(f"elapsed: {elapsed:.1f}s")
            return 0
    except (JudgeError, OSError, ValueError) as exc:
        print(f"vlm-judge error: {exc}", file=sys.stderr)
        return 2
    print(f"vlm-judge error: unknown command {args.command!r}", file=sys.stderr)  # pragma: no cover
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
