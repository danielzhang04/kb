"""Offline module-16 scene intake. No model runner or production authority yet.

FixtureRunner is trusted test code/data, NOT a sandbox for arbitrary plugins.
CanonicalPassportAdapter reuses trusted driver authority; it never grants live extraction.
Its exact-name byte reader exposes only the staged image. A real CLI adapter needs
enforced filesystem containment and canonical passport-registration validation;
until both are integrated, live extraction and live prompt authority are refused.
Nothing here uploads media, writes rendered-image approvals, or dispatches work.
"""
from __future__ import annotations

import hashlib
import base64
import html
import io
import json
import re
import stat
import warnings
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Callable

from PIL import Image

SCHEMA = "figment/prompt-intake-fixture@1"
APPROVAL_SCHEMA = "figment/prompt-approval-fixture@1"
SECTIONS = ("shot_subject", "age_appearance", "clothing", "environment", "lighting",
            "mood", "style", "technical_camera", "cleanup")
DESCRIPTORS = ("face", "hair", "eyes", "skin")
ASPECTS = SECTIONS[2:]
FRAMINGS = ("close-up", "medium", "full", "wide")
MAX_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 16_000_000
MAX_RESPONSE_BYTES = 32_768
TIMEOUT_SECONDS = 30
TEMPLATE = "module16/v1: nine ordered sections; adult subject; passport descriptor replacement; no trigger"
TEMPLATE_SHA256 = hashlib.sha256(TEMPLATE.encode()).hexdigest()
_BAD_TEXT = re.compile(r"[\x00-\x08\x0b-\x1f]|```|(?:ignore|override)\s+(?:all\s+)?(?:previous|system|instructions)|(?:tool_calls?|system_prompt|bypassPermissions)|(?:https?://)|(?:[A-Za-z]:[\\/])", re.I)


class IntakeError(ValueError):
    pass


def _hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def _keys(value, required, label):
    if not isinstance(value, dict) or set(value) != set(required):
        raise IntakeError(f"{label}: exact keys required: {', '.join(required)}")


def _text(value, label, *, empty=False):
    if not isinstance(value, str) or len(value) > 2000 or (not empty and not value.strip()):
        raise IntakeError(f"{label}: bounded nonempty text required")
    if _BAD_TEXT.search(value):
        raise IntakeError(f"{label}: instruction/tool/path content refused")
    return value.strip()


def _path(root: Path, relative: str, *, reads=None) -> Path:
    if not isinstance(relative, str) or "\\" in relative or ":" in relative:
        raise IntakeError("evidence path must be a relative POSIX path")
    parts = relative.split("/")
    if not relative or any(p in ("", ".", "..") or p.rstrip(". ") != p for p in parts):
        raise IntakeError("unsafe evidence path")
    if PurePosixPath(relative).is_absolute():
        raise IntakeError("absolute evidence path refused")
    if reads is not None:
        root = Path(root)
        if not root.is_absolute():
            raise IntakeError("observed evidence root must be absolute")
        return reads.resolve_exact_file(root / relative)
    root = Path(root).absolute()
    # Reject symlinks/junctions in ancestors as well as in supplied components.
    for component in (*reversed(root.parents), root):
        s = component.lstat()
        if stat.S_ISLNK(s.st_mode) or getattr(s, "st_file_attributes", 0) & 0x400:
            raise IntakeError("reparse evidence path refused")
    current = root
    for part in parts:
        names = [p.name for p in current.iterdir() if p.name.casefold() == part.casefold()]
        if names != [part]:
            raise IntakeError("missing, case-mismatched or colliding evidence path")
        current = current / part
        s = current.lstat()
        if stat.S_ISLNK(s.st_mode) or getattr(s, "st_file_attributes", 0) & 0x400:
            raise IntakeError("reparse evidence path refused")
    if not current.is_file():
        raise IntakeError("evidence must be a regular file")
    return current


def _read(root, relative, *, image=False, reads=None):
    try:
        path = _path(root, relative, reads=reads)
        if reads is not None:
            data = reads.read_bytes(path)
        else:
            if path.stat().st_size > MAX_BYTES:
                raise IntakeError("evidence exceeds byte limit")
            with path.open("rb") as handle:
                data = handle.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise IntakeError("evidence exceeds byte limit")
        if image:
            suffix = path.suffix.lower()
            if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
                raise IntakeError("unsupported image type")
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data)) as im:
                    expected = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP"}[suffix]
                    if im.format != expected or im.width * im.height > MAX_PIXELS or getattr(im, "n_frames", 1) != 1:
                        raise IntakeError("unsupported image content or pixel limit")
                    im.verify()
        return data
    except (OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise IntakeError(f"invalid evidence: {relative}") from exc


class StagedEvidence:
    """Exact-name, in-memory read capability; never exposes an original path."""
    def __init__(self, image: bytes):
        self.__image = image

    def read(self, name: str) -> bytes:
        if name != "scene-image":
            raise IntakeError("read denied: only scene-image is staged")
        return self.__image


@dataclass(frozen=True)
class FixtureRunner:
    """Declarative fixture response; elapsed_seconds simulates a bounded timeout.

    No executable callback is accepted: this is not arbitrary plugin confinement.
    """
    response: str
    requested_reads: tuple[str, ...] = ("scene-image",)
    elapsed_seconds: float = 0
    error: str | None = None


def production_local_adapter(*args, **kwargs):
    raise IntakeError("live extraction unavailable: enforced Read sandbox and canonical passport adapter required")


def fixture_passport_binding(root, *, creator, image_path, registration_path, descriptors):
    """Bind synthetic authority bytes for development, never validate registration.

    Production integration MUST replace this with the canonical verified authority
    adapter. An arbitrary receipt hash is deliberately not live authority.
    """
    if not isinstance(creator, str) or not re.fullmatch(r"creator-[0-9]{3,}", creator):
        raise IntakeError("invalid creator")
    _keys(descriptors, DESCRIPTORS, "passport descriptors")
    clean = {k: _text(descriptors[k], k, empty=True) for k in DESCRIPTORS}
    return {"kind": "fixture-registration-only", "creator": creator,
            "image_path": image_path, "image_sha256": _hash(_read(root, image_path, image=True)),
            "registration_path": registration_path,
            "registration_sha256": _hash(_read(root, registration_path)), "descriptors": clean}



@dataclass(frozen=True)
class CanonicalPassportAdapter:
    """Trusted application adapters, never user plugins or extraction tools.

    resolve_authority(creator, selection) MUST call the phase3 driver's canonical
    registered-passport validator with freshly loaded persona state. The returned
    hash is checked for consistency here, not treated as a substitute for that
    validator. resolve_descriptors(creator, authority) freshly projects the four
    approved slots; absent face text stays empty. No callback is sandboxed here.
    """
    resolve_authority: Callable
    resolve_descriptors: Callable


def canonical_passport_binding(*, creator, selection, passport_adapter, reads=None):
    """Revalidate registration and descriptors for a fixture-only intake draft."""
    if type(passport_adapter) is not CanonicalPassportAdapter:
        raise IntakeError("trusted canonical passport adapter required")
    if not isinstance(creator, str) or not re.fullmatch(r"creator-[0-9]{3,}", creator):
        raise IntakeError("invalid creator")
    _keys(selection, ("source_plan", "image_id"), "passport selection")
    if any(not isinstance(selection[k], str) or not selection[k].strip() for k in selection):
        raise IntakeError("passport selection requires original plan and image id")
    selection = json.loads(_canonical(selection))
    authority = passport_adapter.resolve_authority(creator, dict(selection))
    _keys(authority, ("schema", "creator", "fixture", "image", "source_plan", "chosen_anchor",
                      "approval_lineage", "rulings", "registered_reference", "authority_sha256"),
          "canonical passport authority")
    if (authority["schema"] != "figment/registered-passport-authority@1"
            or authority["creator"] != creator or type(authority["fixture"]) is not bool
            or not isinstance(authority["image"], dict)
            or authority["image"].get("image_id") != selection["image_id"]):
        raise IntakeError("canonical passport identity is incomplete or mismatched")
    for key in ("image", "source_plan", "chosen_anchor", "approval_lineage", "rulings"):
        record = authority[key]
        if (not isinstance(record, dict) or not isinstance(record.get("path"), str)
                or not record["path"] or not isinstance(record.get("sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", record["sha256"])):
            raise IntakeError("canonical passport authority lacks bound evidence")
    if reads is None:
        authority_plan = Path(authority["source_plan"]["path"]).resolve()
        selected_plan = Path(selection["source_plan"]).resolve()
    else:
        authority_plan = reads.resolve_exact_file(Path(authority["source_plan"]["path"]))
        selected_plan = reads.resolve_exact_file(Path(selection["source_plan"]))
    if authority_plan != selected_plan:
        raise IntakeError("canonical authority belongs to another original plan")
    if (not isinstance(authority["registered_reference"], str) or not authority["registered_reference"]
            or authority["authority_sha256"] != _hash(_canonical({k: v for k, v in authority.items()
                                                                   if k != "authority_sha256"}))):
        raise IntakeError("canonical passport authority digest is inconsistent")
    # Snapshot before the second callback, which must not mutate verified evidence.
    authority = json.loads(_canonical(authority))
    descriptors = passport_adapter.resolve_descriptors(creator, json.loads(_canonical(authority)))
    _keys(descriptors, DESCRIPTORS, "passport descriptors")
    clean = {k: _text(descriptors[k], k, empty=True) for k in DESCRIPTORS}
    source = {"authority_sha256": authority["authority_sha256"], "descriptors": clean}
    return {"kind": "canonical-registration-fixture-intake", "creator": creator,
            "selection": selection, "authority": authority, "descriptors": clean,
            "descriptor_projection_sha256": _hash(_canonical(source))}


def _passport(root, binding, creator, passport_adapter=None, *, reads=None):
    if isinstance(binding, dict) and binding.get("kind") == "canonical-registration-fixture-intake":
        _keys(binding, ("kind", "creator", "selection", "authority", "descriptors",
                        "descriptor_projection_sha256"), "canonical intake passport")
        current = canonical_passport_binding(creator=creator, selection=binding["selection"],
                                              passport_adapter=passport_adapter, reads=reads)
        if current != binding:
            raise IntakeError("canonical passport authority or descriptors changed")
        return
    if reads is not None:
        raise IntakeError("observed intake requires canonical passport authority")
    _keys(binding, ("kind", "creator", "image_path", "image_sha256", "registration_path",
                    "registration_sha256", "descriptors"), "passport binding")
    if binding["kind"] != "fixture-registration-only" or binding["creator"] != creator:
        raise IntakeError("incomplete or mismatched fixture passport binding")
    current = fixture_passport_binding(root, creator=creator, image_path=binding["image_path"],
                                      registration_path=binding["registration_path"],
                                      descriptors=binding["descriptors"])
    if current != binding:
        raise IntakeError("passport evidence changed")


def _parse(response):
    if not isinstance(response, str) or len(response) > MAX_RESPONSE_BYTES or len(response.encode("utf-8")) > MAX_RESPONSE_BYTES:
        raise IntakeError("response exceeds byte limit")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise IntakeError("duplicate response key")
            result[key] = value
        return result
    try:
        raw = json.loads(response, object_pairs_hook=unique)
    except (ValueError, RecursionError) as exc:
        raise IntakeError("strict JSON response required") from exc
    _keys(raw, SECTIONS, "extractor sections")
    if raw["shot_subject"] != "one adult person":
        raise IntakeError("subject must be anonymous one adult person")
    _keys(raw["age_appearance"], DESCRIPTORS, "extracted appearance")
    raw["age_appearance"] = {k: _text(raw["age_appearance"][k], k, empty=True) for k in DESCRIPTORS}
    for key in ASPECTS:
        raw[key] = _text(raw[key], key, empty=True)
    return raw


def _compose(raw, binding, aspects):
    descriptors = binding["descriptors"]
    corrected = {"shot_subject": "One adult person.",
                 "age_appearance": "; ".join(f"{k}: {descriptors[k]}" for k in DESCRIPTORS if descriptors[k]) + "."}
    for key in ASPECTS:
        value = raw[key] if key in aspects else ""
        # Reject known extracted identity spilling into a selected scene section.
        # This is not a universal name detector: full prose still needs review.
        for old in raw["age_appearance"].values():
            if old and old.casefold() in value.casefold():
                raise IntakeError("reference identity leaked into scene aspect")
        corrected[key] = value
    text = " ".join(corrected[k] for k in SECTIONS if corrected[k]).strip()
    count = len(text.split())
    if count > 300:
        raise IntakeError("corrected prompt exceeds 300 words")
    gaps = [f"missing passport {key}" for key in DESCRIPTORS if not descriptors[key]]
    notes = ["full prose needs human review for names, identity and scene fidelity"]
    if count < 80 or count > 250:
        notes.append("outside source target of 80-250 words")
    return corrected, text, gaps, notes


def extract_fixture_draft(root, *, photo_path, creator, passport, aspects, framing, runner, passport_adapter=None, reads=None):
    """One deterministic offline fixture attempt. Never calls a model or retries."""
    if type(runner) is not FixtureRunner:
        raise IntakeError("only declarative fixture runners supported")
    if framing not in FRAMINGS:
        raise IntakeError("explicit supported framing required")
    if not isinstance(aspects, (list, tuple)) or any(a not in ASPECTS for a in aspects) or len(set(aspects)) != len(aspects):
        raise IntakeError("unknown or duplicate selected aspect")
    _passport(root, passport, creator, passport_adapter, reads=reads)
    image = _read(root, photo_path, image=True, reads=reads)
    staged = StagedEvidence(image)
    if not isinstance(runner.requested_reads, tuple) or len(runner.requested_reads) > 4:
        raise IntakeError("fixture read budget exceeded")
    for requested in runner.requested_reads:
        staged.read(requested)
    elapsed = runner.elapsed_seconds
    if isinstance(elapsed, bool) or not isinstance(elapsed, (int, float)) or not 0 <= elapsed <= TIMEOUT_SECONDS:
        raise IntakeError("fixture attempt timeout or invalid duration")
    if runner.error:
        raise IntakeError("fixture extraction failed")
    raw = _parse(runner.response)
    corrected, text, gaps, notes = _compose(raw, passport, aspects)
    document = {"schema": SCHEMA, "fixture": True, "creator": creator,
                "photo": {"path": photo_path, "sha256": _hash(image)},
                "passport": json.loads(_canonical(passport)), "aspects": list(aspects), "framing": framing,
                "template_sha256": TEMPLATE_SHA256, "raw": raw, "corrected": corrected,
                "text": text, "text_sha256": _hash(text.encode()), "gaps": gaps, "review_notes": notes,
                "corrections": [{"section": k, "before": raw[k], "after": corrected[k]}
                                for k in SECTIONS if raw[k] != corrected[k]],
                "runner": {"kind": "declarative-fixture", "model": None, "attempts": 1,
                           "elapsed_seconds": elapsed}}
    document["draft_sha256"] = _hash(_canonical(document))
    return document


def _validate_draft(root, draft, passport_adapter=None, *, reads=None):
    fields = ("schema", "fixture", "creator", "photo", "passport", "aspects", "framing",
              "template_sha256", "raw", "corrected", "text", "text_sha256", "gaps", "review_notes",
              "corrections", "runner", "draft_sha256")
    _keys(draft, fields, "draft")
    _keys(draft["photo"], ("path", "sha256"), "photo")
    _keys(draft["runner"], ("kind", "model", "attempts", "elapsed_seconds"), "runner")
    if draft["runner"] != {"kind": "declarative-fixture", "model": None, "attempts": 1,
                            "elapsed_seconds": draft["runner"]["elapsed_seconds"]}:
        raise IntakeError("invalid fixture provenance")
    rebuilt = extract_fixture_draft(root, photo_path=draft["photo"]["path"], creator=draft["creator"],
                                    passport=draft["passport"], aspects=draft["aspects"], framing=draft["framing"],
                                    runner=FixtureRunner(json.dumps(draft["raw"]),
                                                         elapsed_seconds=draft["runner"]["elapsed_seconds"]),
                                    passport_adapter=passport_adapter, reads=reads)
    if rebuilt != draft:
        raise IntakeError("draft or evidence changed")


def _decision(by, at):
    if not isinstance(by, str) or not re.fullmatch(r"fixture:[A-Za-z0-9_-]{1,64}", by):
        raise IntakeError("fixture-attributed decided_by required; not an operator decision")
    if not isinstance(at, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})", at):
        raise IntakeError("timezone-aware decided_at required")
    try:
        datetime.fromisoformat(at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise IntakeError("invalid decided_at") from exc


def approve_fixture_prompt(root, draft, *, decided_by, decided_at, acknowledged_notes, passport_adapter=None, reads=None):
    _validate_draft(root, draft, passport_adapter, reads=reads)
    _decision(decided_by, decided_at)
    if draft["gaps"] or acknowledged_notes != draft["review_notes"]:
        raise IntakeError("descriptor gaps or unacknowledged full-prose review")
    result = {"schema": APPROVAL_SCHEMA, "fixture": True, "draft_sha256": draft["draft_sha256"],
              "decided_by": decided_by, "decided_at": decided_at, "acknowledged_notes": list(acknowledged_notes)}
    result["approval_sha256"] = _hash(_canonical(result))
    return result


def approved_prompt_projection(root, draft, approval, *, current_passport, live=False, passport_adapter=None, reads=None):
    """Text-only downstream projection; no photo bytes or filesystem paths.

    Caller still owns canonical passport authority revalidation in future live
    integration. Synthetic approval never authorizes pod launch or image promotion.
    """
    if live:
        raise IntakeError("fixture prompt cannot become live authority")
    _passport(root, current_passport, draft["creator"], passport_adapter, reads=reads)
    if current_passport != draft["passport"]:
        raise IntakeError("current passport binding changed")
    _keys(approval, ("schema", "fixture", "draft_sha256", "decided_by", "decided_at",
                     "acknowledged_notes", "approval_sha256"), "approval")
    rebuilt = approve_fixture_prompt(root, draft, decided_by=approval["decided_by"],
                                     decided_at=approval["decided_at"], acknowledged_notes=approval["acknowledged_notes"],
                                     passport_adapter=passport_adapter, reads=reads)
    if rebuilt != approval:
        raise IntakeError("approval changed or belongs to another draft")
    result = {"fixture": True, "creator": draft["creator"], "text": draft["text"],
            "framing": draft["framing"], "text_sha256": draft["text_sha256"],
            "approval_sha256": approval["approval_sha256"], "draft_sha256": draft["draft_sha256"]}

    if current_passport["kind"] == "canonical-registration-fixture-intake":
        result["passport_authority_sha256"] = current_passport["authority"]["authority_sha256"]
        result["descriptor_projection_sha256"] = current_passport["descriptor_projection_sha256"]
    return result


def preview_fixture_html(root, draft, *, passport_adapter=None):
    """Local review artifact only; validation and rendering never create approval."""
    _validate_draft(root, draft, passport_adapter)
    esc = lambda value: html.escape(str(value), quote=True)
    def thumbnail(label, folder, name, expected):
        raw = _read(folder, name, image=True)
        if _hash(raw) != expected:
            raise IntakeError("preview image changed")
        with Image.open(io.BytesIO(raw)) as image:
            mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[image.format]
        data = base64.b64encode(raw).decode("ascii")
        return (f'<figure><img alt="{esc(label)}" src="data:{mime};base64,{data}">'
                f'<figcaption>{esc(label)} — {esc(name)}<br>SHA256 {esc(expected)}</figcaption></figure>')
    photo = draft["photo"]
    images = thumbnail("Scene reference", root, photo["path"], photo["sha256"])
    passport = draft["passport"]
    if passport["kind"] == "fixture-registration-only":
        images += thumbnail("Passport", root, passport["image_path"], passport["image_sha256"])
    else:
        image = passport["authority"]["image"]
        path = Path(image["path"])
        images += thumbnail("Passport", path.parent, path.name, image["sha256"])
    show = lambda value: esc(json.dumps(value, ensure_ascii=False) if isinstance(value, dict) else value)
    sections = "".join(f'<section><h3>{esc(key)}</h3><p>{show(draft["corrected"][key])}</p></section>' for key in SECTIONS)
    diffs = "".join(f'<tr><th>{esc(row["section"])}</th><td>{show(row["before"])}</td><td>{show(row["after"])}</td></tr>'
                    for row in draft["corrections"])
    notes = "".join(f'<li>{esc(note)}</li>' for note in draft["gaps"] + draft["review_notes"])
    return ("<!doctype html><html><head><meta charset='utf-8'><title>Fixture prompt review</title>"
            "<style>body{font:16px system-ui;max-width:1100px;margin:2rem auto;padding:1rem}"
            "figure{display:inline-block;vertical-align:top;width:42%;margin:1rem}img{max-width:100%;max-height:360px}"
            "figcaption,td,pre{overflow-wrap:anywhere;white-space:pre-wrap}table{width:100%;border-collapse:collapse}"
            "td,th{padding:.6rem;border:1px solid #bbb;text-align:left}aside{background:#fff1c5;padding:1rem}</style>"
            "</head><body><h1>Fixture prompt review</h1><aside>FIXTURE ONLY — no operator approval or live extraction.</aside>"
            f'<p>Creator: {esc(draft["creator"])} · Framing: {esc(draft["framing"])}</p>'
            f'<p>Selected aspects: {esc(", ".join(draft["aspects"]))}</p>{images}<h2>Gaps and review notes</h2><ul>{notes}</ul>'
            f'<h2>Exact corrected prompt</h2><pre>{esc(draft["text"])}</pre><p>Text SHA256: {esc(draft["text_sha256"])}</p>'
            f'<p>Draft SHA256: {esc(draft["draft_sha256"])}</p><h2>Nine sections</h2>{sections}'
            f'<h2>Replacement diff</h2><table><thead><tr><th>Section</th><th>Extracted</th><th>Corrected</th></tr></thead><tbody>{diffs}</tbody></table>'
            '</body></html>')
