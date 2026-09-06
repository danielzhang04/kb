#!/usr/bin/env python3
"""verify_pins.py — HEAD every model pin in `tensor-pins.yaml` against Hugging Face and
fail closed on any digest or revision mismatch.

Review finding (REVIEW-2026-09-06-phase-a.md, HIGH-1 / LOW-15): all four `pins.anchor`
sha256 digests were wrong and nothing caught it — the only pre-existing test checked
`len(sha256) == 64`, not the value. This script is the missing check: for every model pin,
HEAD `https://huggingface.co/<repo_id>/resolve/<revision>/<filename>` and compare the live
`x-linked-etag` response header (HF's LFS sha256, exactly as `pytest`'d cross-validation in
the review) against the pinned `sha256`, and confirm the pinned `revision` is the commit the
URL actually resolves to (`x-repo-commit`).

HF's `resolve` endpoint answers an LFS file with a 302 to a signed CDN URL and puts
`x-linked-etag`/`x-repo-commit` on THAT redirect response, not on the CDN response a
redirect-following client ends up with — so this deliberately does not follow the redirect
(see `head_etag`). A 200 (small non-LFS file, answered directly) is accepted the same way a
302 is; anything else (404 = wrong revision/filename, 401/403 = gated repo, ...) fails
closed.

`--stage <name>` (repeatable) limits verification to specific `pins.pins` keys; the default
is every stage. Exit code is non-zero on any problem, and `figment_train.py plan` runs this
as a preflight (see `_verify_pins_preflight`, skippable with `--skip-pin-verify`).
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
DEFAULT_PINS_PATH = HERE / "tensor-pins.yaml"
_ACCEPTABLE_STATUSES = (200, 302)


class VerifyPinsError(RuntimeError):
    """A pin failed to verify, or the pins document/stage selection is invalid."""


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Stop urllib from following the 301/302 HF puts `x-linked-etag` on.

    A followed redirect lands on the CDN response, which does not carry the header this
    script needs; returning None here makes the handler surface the redirect itself as an
    `HTTPError` instead, whose `.headers` carries `x-linked-etag`/`x-repo-commit`.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


_OPENER = urllib.request.build_opener(_NoRedirectHandler)


def _read_pins(path: Path) -> dict[str, Any]:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise VerifyPinsError(f"cannot read pins document {path}: {exc}") from exc


def _pin_url(model: dict[str, Any]) -> str:
    return (
        f"https://huggingface.co/{model['repo_id']}/resolve/"
        f"{model['revision']}/{model['filename']}"
    )


def head_etag(url: str, *, timeout: float = 30.0) -> tuple[int, dict[str, str]]:
    """Return (status_code, headers) for a HEAD request that never follows a redirect.

    Not parameterized with a default-argument hook on purpose — tests monkeypatch this
    module-level name directly (`monkeypatch.setattr(verify_pins, "head_etag", stub)`),
    which only works cleanly against a plain global lookup, not a value already bound into
    another function's default argument at import time.
    """
    request = urllib.request.Request(url, method="HEAD")
    try:
        response = _OPENER.open(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers)
    except urllib.error.URLError as exc:
        raise VerifyPinsError(f"could not reach {url}: {exc}") from exc
    try:
        return response.status, dict(response.headers)
    finally:
        response.close()


def verify_model_pin(model: dict[str, Any]) -> list[str]:
    """Return problem strings for one model pin; empty when it verifies clean."""
    label = f"{model.get('repo_id')}@{model.get('revision')} {model.get('filename')}"
    for key in ("repo_id", "revision", "filename", "sha256"):
        if not isinstance(model.get(key), str) or not model[key].strip():
            return [f"{label}: pin is missing a non-empty {key!r}"]

    url = _pin_url(model)
    status, headers = head_etag(url)
    lowered = {k.lower(): v for k, v in headers.items()}
    if status not in _ACCEPTABLE_STATUSES:
        return [f"{label}: revision/file did not resolve (HTTP {status}, {url})"]

    commit = lowered.get("x-repo-commit")
    if commit is not None and commit != model["revision"]:
        return [
            f"{label}: pinned revision does not resolve to itself "
            f"(x-repo-commit={commit!r})"
        ]

    etag = lowered.get("x-linked-etag")
    if not etag:
        return [f"{label}: response carried no x-linked-etag header to verify against"]
    etag = etag.strip().strip('"')
    if etag.lower() != model["sha256"].lower():
        return [
            f"{label}: sha256 mismatch — pinned {model['sha256']}, live x-linked-etag {etag}"
        ]
    return []


def verify_pins(
    pins: dict[str, Any], *, stages: list[str] | None = None,
) -> dict[str, list[str]]:
    """Verify every model pin under the selected stage(s). Returns {stage: [problem, ...]}
    only for stages that had at least one problem."""
    all_pins = pins.get("pins")
    if not isinstance(all_pins, dict):
        raise VerifyPinsError("tensor-pins.yaml has no 'pins' object")
    selected = list(stages) if stages is not None else sorted(all_pins)
    unknown = sorted(set(selected) - set(all_pins))
    if unknown:
        raise VerifyPinsError(f"unknown stage(s): {unknown}; known: {sorted(all_pins)}")

    results: dict[str, list[str]] = {}
    for stage in selected:
        models = all_pins[stage].get("models") or []
        problems: list[str] = []
        for model in models:
            problems.extend(verify_model_pin(model))
        if problems:
            results[stage] = problems
    return results


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pins", type=Path, default=DEFAULT_PINS_PATH)
    parser.add_argument(
        "--stage", action="append", default=None,
        help="limit verification to this pins.pins stage (repeatable); default: every stage",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    pins = _read_pins(args.pins)
    try:
        results = verify_pins(pins, stages=args.stage)
    except VerifyPinsError as exc:
        print(f"STOP: {exc}", file=sys.stderr)
        return 1
    checked = args.stage if args.stage is not None else sorted(pins.get("pins", {}))
    if results:
        for stage in checked:
            for problem in results.get(stage, []):
                print(f"STOP [{stage}]: {problem}", file=sys.stderr)
        return 1
    print(f"verified {len(checked)} stage(s) clean: {', '.join(checked)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
