"""File-mediated, desktop-local preparation and consumption of fit-spec model jobs."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
import json
from pathlib import Path

from scripts.prospecting.store import resolve_store_path
from scripts.prospecting.manager.compile_ask import CompileError, URL, _split_fit_lines

from .anchors import SenderAnchors, anchors_path, load_anchors
from .fitspec import (
    FitSpecError, fit_spec_hash, has_executed_work, render_fit_table, store_proposed,
    validate_fit_spec,
)


@dataclass(frozen=True)
class CompileOutcome:
    state: str
    job_path: Path | None
    fit_spec_hash: str | None
    table: Mapping[str, int | str] | None


def build_prompt(fit_text: str, anchors: SenderAnchors, campaign_intent: str) -> str:
    """Build a deterministic desktop-only request for a version-one fit spec."""
    context = {
        "career_track": anchors.career_track,
        "domains": sorted(anchors.domains),
        "employer_kinds": dict(anchors.employer_kinds),
        "skills": sorted(anchors.skills),
    }
    return (
        "Compile the following campaign fit notes into one JSON object matching fit-spec version 1.\n"
        "Return JSON only; do not include prose or markdown.\n"
        f"Campaign intent: {campaign_intent}\n"
        f"Sender anchors: {json.dumps(context, sort_keys=True, separators=(',', ':'))}\n"
        f"Fit notes:\n{fit_text}\n"
    )


def write_job(prompt: str, campaign_id: str) -> Path:
    """Write a model job beside the store, where the P6 ask-file rule permits it."""
    path = resolve_store_path().parent / f"fit-job-{campaign_id}.txt"
    path.write_text(prompt, encoding="utf-8")
    return path


def read_response(path: Path) -> Mapping[str, object]:
    """Read a JSON-only model response and validate it as a fit spec."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise FitSpecError("fit_spec_schema") from error
    return validate_fit_spec(payload)


def compile_fit_spec(connection, campaign_id: str, ask_file: Path, response_file: Path | None, now: str) -> CompileOutcome:
    """Prepare a prompt, or consume a returned fit spec without any in-process model call."""
    campaign = connection.execute(
        "SELECT intent,status FROM campaign WHERE campaign_id=?", (campaign_id,)
    ).fetchone()
    if campaign is None:
        raise FitSpecError("unknown_campaign")
    if campaign["status"] != "draft" or has_executed_work(connection, campaign_id):
        raise FitSpecError("fit_spec_locked")
    if response_file is None:
        raw_ask = ask_file.read_text(encoding="utf-8")
        try:
            if URL.search(raw_ask):
                raise CompileError("url_rejected")
            _token_text, fit_text = _split_fit_lines(raw_ask)
        except CompileError as error:
            raise FitSpecError("fit_spec_schema") from error
        prompt = build_prompt(
            fit_text, load_anchors(anchors_path()), campaign["intent"],
        )
        return CompileOutcome("awaiting_model", write_job(prompt, campaign_id), None, None)
    spec = read_response(response_file)
    digest = store_proposed(connection, campaign_id, spec, now)
    return CompileOutcome("proposed", None, digest, render_fit_table(spec))
