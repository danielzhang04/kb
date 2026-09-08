import base64
import hashlib
import importlib.util
import json
import sys
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image


EXPAND = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gi = load_module("figment_expand_gemini_input", EXPAND / "gemini_input.py")
NOW = datetime(2026, 9, 8, 12, 0, tzinfo=timezone.utc)
def jpeg(width, height):
    target = BytesIO()
    Image.new("RGB", (width, height), (50, 90, 130)).save(target, format="JPEG", quality=85)
    return target.getvalue()


JPEG = jpeg(3, 2)
OUTPUT_JPEG = jpeg(2752, 1536)
PROMPT = "A fictional adult woman in an opaque black top in an ordinary bedroom."


def manifest(root: Path, *, admission="admitted", source_hash=None, output_dir="out"):
    source = root / gi.CANONICAL_G01_PATH
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(JPEG)
    attestation = root / "_private" / "fixture" / "model-attestation.json"
    attestation.parent.mkdir(parents=True, exist_ok=True)
    attestation.write_text(json.dumps({
        "schema": "figment/provider-metadata-observation@1", "observed_utc": "2026-09-08T12:19:16Z",
        "observer": "test", "operation": "metadata only", "http_status": 200,
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image",
        "model": {"name": "models/gemini-3-pro-image", "version": "3.0", "inputTokenLimit": 131072,
                  "outputTokenLimit": 32768,
                  "supportedGenerationMethods": ["generateContent", "countTokens", "batchGenerateContent"]},
    }, separators=(",", ":")), encoding="utf-8")
    gi.MODEL_ATTESTATION_PATH = attestation.relative_to(root).as_posix()
    gi.MODEL_ATTESTATION_SHA256 = hashlib.sha256(attestation.read_bytes()).hexdigest()
    value = {
        "schema": gi.SCHEMA,
        "request_id": "gemini-e01-001",
        "issued_at_utc": (NOW - timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
        "expires_at_utc": (NOW + timedelta(minutes=10)).isoformat().replace("+00:00", "Z"),
        "admission": {"state": admission, "reference": "admission-001", "ledger_reservation_ref": "reserve-001", "reservation_usd": 4.60},
        "model_metadata_attestation": {"path": gi.MODEL_ATTESTATION_PATH, "sha256": gi.MODEL_ATTESTATION_SHA256},
        "source": {"id": "creator-001/g01", "path": gi.CANONICAL_G01_PATH, "sha256": source_hash or hashlib.sha256(JPEG).hexdigest(), "mime_type": "image/jpeg"},
        "prompt": PROMPT,
        "request": {"model": gi.MODEL, "candidate_count": 1, "max_output_tokens": 4096,
                    "response_modalities": ["IMAGE"], "image_size": "2K", "aspect_ratio": "16:9",
                    "grounding": False, "tools": False},
        "output": {"directory": output_dir, "candidate_stem": "g01-gemini-e01", "receipt": f"{output_dir}/receipt.json"},
    }
    path = root / "manifest.json"
    path.write_text(json.dumps(gi.freeze_manifest(value)), encoding="utf-8")
    return path


class Response:
    def __init__(self, body, status_code=200, headers=None):
        self.body = body
        self.status_code = status_code
        self.headers = headers or {}
        self.closed = False

    def iter_content(self, chunk_size):
        for start in range(0, len(self.body), chunk_size):
            yield self.body[start:start + chunk_size]

    def close(self):
        self.closed = True


def response(image=OUTPUT_JPEG, mime="image/jpeg"):
    return Response(json.dumps({
        "modelVersion": "gemini-3-pro-image",
        "usageMetadata": {"promptTokenCount": 560, "candidatesTokenCount": 1120, "thoughtsTokenCount": 20, "totalTokenCount": 1700,
                          "serviceTier": "PAID", "candidatesTokensDetails": [{"modality": "IMAGE", "tokenCount": 1120}]},
        "candidates": [{"content": {"parts": [{"inlineData": {"mimeType": mime, "data": base64.b64encode(image).decode("ascii")}}]}}],
    }).encode("utf-8"))


@pytest.fixture(autouse=True)
def ledger(monkeypatch):
    monkeypatch.setattr(gi, "CANONICAL_G01_SHA256", hashlib.sha256(JPEG).hexdigest())
    monkeypatch.setattr(gi, "FROZEN_E01_PROMPT_SHA256", hashlib.sha256(PROMPT.encode("utf-8")).hexdigest())
    monkeypatch.setattr(gi, "ledger_preflight", lambda *_args, **_kwargs: {
        "daily_limit_usd": 10.0, "daily_spent_before_usd": 2.110134,
        "arc_cap_usd": 50.0, "arc_spent_before_usd": 37.800385,
    })


def test_default_plan_is_offline_and_does_not_read_ambient_key(tmp_path, monkeypatch):
    path = manifest(tmp_path)

    class Environment(dict):
        def get(self, *_args, **_kwargs):
            raise AssertionError("dry plan read ambient credential")

    monkeypatch.setattr(gi.os, "environ", Environment())
    summary = gi.plan_summary(Path("manifest.json"), root=tmp_path, now=NOW)
    assert summary["dry_run"] is True
    assert summary["network"] is False
    assert summary["credential_read"] is False
    assert not (tmp_path / "out").exists()


def test_frozen_manifest_detects_tampering_and_stale_admission(tmp_path):
    path = manifest(tmp_path)
    value = json.loads(path.read_text())
    value["prompt"] = "changed"
    path.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(gi.GeminiInputError, match="frozen_sha256"):
        gi.load_manifest(Path("manifest.json"), root=tmp_path, now=NOW)

    path = manifest(tmp_path)
    value = json.loads(path.read_text())
    value["admission"]["state"] = "pending"
    path.write_text(json.dumps(gi.freeze_manifest(value)), encoding="utf-8")
    with pytest.raises(gi.GeminiInputError, match="not admitted"):
        gi.load_manifest(Path("manifest.json"), root=tmp_path, now=NOW)


def test_source_hash_path_and_pixel_caps_refuse_before_transport(tmp_path):
    path = manifest(tmp_path, source_hash="a" * 64)
    with pytest.raises(gi.GeminiInputError, match="hash-bound JPEG"):
        gi.plan_summary(Path("manifest.json"), root=tmp_path, now=NOW)

    path = manifest(tmp_path)
    value = json.loads(path.read_text())
    value["source"]["path"] = "../g01.jpg"
    path.write_text(json.dumps(gi.freeze_manifest(value)), encoding="utf-8")
    with pytest.raises(gi.GeminiInputError, match="root-relative"):
        gi.plan_summary(Path("manifest.json"), root=tmp_path, now=NOW)

    # A JPEG that advertises more than the image pixel cap is rejected before an API call.
    source = tmp_path / gi.CANONICAL_G01_PATH
    source.write_bytes(jpeg(5000, 5000))
    value["source"]["path"] = gi.CANONICAL_G01_PATH
    value["source"]["sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
    gi.CANONICAL_G01_SHA256 = value["source"]["sha256"]
    path.write_text(json.dumps(gi.freeze_manifest(value)), encoding="utf-8")
    with pytest.raises(gi.GeminiInputError, match="dimensions"):
        gi.plan_summary(Path("manifest.json"), root=tmp_path, now=NOW)


def test_source_requires_canonical_path_and_real_pillow_decode(tmp_path):
    path = manifest(tmp_path)
    value = json.loads(path.read_text())
    other = tmp_path / "other.jpg"
    other.write_bytes(JPEG)
    value["source"]["path"] = "other.jpg"
    path.write_text(json.dumps(gi.freeze_manifest(value)), encoding="utf-8")
    with pytest.raises(gi.GeminiInputError, match="hash-bound JPEG"):
        gi.plan_summary(Path("manifest.json"), root=tmp_path, now=NOW)

    path = manifest(tmp_path)
    source = tmp_path / gi.CANONICAL_G01_PATH
    header_only = b"\xff\xd8\xff\xc0\x00\x08\x08\x00\x02\x00\x03\x00\xff\xd9"
    source.write_bytes(header_only)
    value = json.loads(path.read_text())
    value["source"]["sha256"] = hashlib.sha256(header_only).hexdigest()
    gi.CANONICAL_G01_SHA256 = value["source"]["sha256"]
    path.write_text(json.dumps(gi.freeze_manifest(value)), encoding="utf-8")
    with pytest.raises(gi.GeminiInputError, match="decode"):
        gi.plan_summary(Path("manifest.json"), root=tmp_path, now=NOW)


def test_model_attestation_is_fixed_path_and_hash_not_manifest_selected(tmp_path):
    path = manifest(tmp_path)
    value = json.loads(path.read_text(encoding="utf-8"))
    value["model_metadata_attestation"]["path"] = "other-observation.json"
    (tmp_path / "other-observation.json").write_bytes((tmp_path / gi.MODEL_ATTESTATION_PATH).read_bytes())
    value["model_metadata_attestation"]["sha256"] = hashlib.sha256((tmp_path / "other-observation.json").read_bytes()).hexdigest()
    path.write_text(json.dumps(gi.freeze_manifest(value)), encoding="utf-8")
    with pytest.raises(gi.GeminiInputError, match="fixed Gemini"):
        gi.plan_summary(Path("manifest.json"), root=tmp_path, now=NOW)


def test_execute_is_one_call_and_persists_raw_returned_jpeg_and_sanitized_receipt(tmp_path, monkeypatch):
    manifest(tmp_path)
    monkeypatch.setitem(gi.os.environ, "GEMINI_API_KEY", "test-only-key")
    calls = []

    def transport(payload, key):
        calls.append((payload, key))
        return response()

    receipt = gi.execute_manifest(Path("manifest.json"), root=tmp_path, now=NOW, transport=transport)
    assert len(calls) == 1
    payload, _key = calls[0]
    assert payload["generationConfig"] == {
        "candidateCount": 1, "maxOutputTokens": 4096, "responseModalities": ["IMAGE"],
        "imageConfig": {"imageSize": "2K", "aspectRatio": "16:9"},
    }
    assert "tools" not in payload and "grounding" not in payload
    candidate = tmp_path / "out" / "g01-gemini-e01.jpg"
    assert candidate.read_bytes() == OUTPUT_JPEG
    receipt_path = tmp_path / "out" / "receipt.json"
    saved = json.loads(receipt_path.read_text())
    assert saved == receipt
    assert saved["status"] == "succeeded"
    assert saved["output"]["sha256"] == hashlib.sha256(OUTPUT_JPEG).hexdigest()
    assert saved["provider"]["usage"]["thought_tokens"] == 20
    assert saved["provider"]["usage"]["service_tier"] == "PAID"
    assert saved["provider"]["usage"]["candidate_token_details"] == [{"modality": "IMAGE", "token_count": 1120}]
    assert "test-only-key" not in receipt_path.read_text()
    assert "prompt" not in saved and "response" not in saved


def test_timeout_or_provider_error_writes_one_unconfirmed_full_reservation_receipt(tmp_path, monkeypatch):
    manifest(tmp_path)
    monkeypatch.setitem(gi.os.environ, "GEMINI_API_KEY", "test-only-key")
    calls = []

    def transport(_payload, _key):
        calls.append(1)
        raise TimeoutError("provider body must not escape")

    with pytest.raises(gi.GeminiInputError, match="not confirmed"):
        gi.execute_manifest(Path("manifest.json"), root=tmp_path, now=NOW, transport=transport)
    assert calls == [1]
    receipt = json.loads((tmp_path / "out" / "receipt.json").read_text())
    assert receipt["status"] == "unconfirmed"
    assert receipt["reservation_usd"] == 4.60
    assert receipt["billing_status"] == "unconfirmed-reserve-full"
    assert "provider body" not in (tmp_path / "out" / "receipt.json").read_text()
    assert not list((tmp_path / "out").glob("*.jpg"))
    # The pre-dispatch exclusive journal prevents any later invocation from retrying.
    monkeypatch.setattr(gi.os, "environ", {})
    with pytest.raises(gi.GeminiInputError, match="fresh"):
        gi.plan_summary(Path("manifest.json"), root=tmp_path, now=NOW)


def test_malformed_or_multiple_images_are_unconfirmed_without_artifact(tmp_path, monkeypatch):
    manifest(tmp_path)
    monkeypatch.setitem(gi.os.environ, "GEMINI_API_KEY", "test-only-key")
    malformed = Response(b'{"candidates": []}')
    with pytest.raises(gi.GeminiInputError, match="exactly one candidate"):
        gi.execute_manifest(Path("manifest.json"), root=tmp_path, now=NOW, transport=lambda *_: malformed)
    assert malformed.closed
    assert not list((tmp_path / "out").glob("*.jpg"))
    assert json.loads((tmp_path / "out" / "receipt.json").read_text())["status"] == "unconfirmed"


def test_invalid_image_response_keeps_only_sanitized_provider_metadata(tmp_path, monkeypatch):
    manifest(tmp_path)
    monkeypatch.setitem(gi.os.environ, "GEMINI_API_KEY", "test-only-key")
    body = {
        "modelVersion": "gemini-3-pro-image-202609",
        "usageMetadata": {"promptTokenCount": 7, "serviceTier": "PAID"},
        "candidates": [],
        "untrusted": "provider response body must never be recorded",
    }
    with pytest.raises(gi.GeminiInputError, match="exactly one candidate"):
        gi.execute_manifest(Path("manifest.json"), root=tmp_path, now=NOW,
                            transport=lambda *_: Response(json.dumps(body).encode("utf-8")))
    receipt_text = (tmp_path / "out" / "receipt.json").read_text(encoding="utf-8")
    receipt = json.loads(receipt_text)
    assert receipt["status"] == "unconfirmed"
    assert receipt["provider"] == {
        "model": gi.MODEL, "model_version": "gemini-3-pro-image-202609",
        "usage": {"prompt_tokens": 7, "service_tier": "PAID"},
    }
    assert "untrusted" not in receipt_text and "candidates" not in receipt_text


def test_thought_inline_image_is_ignored_before_selecting_one_final_image(tmp_path, monkeypatch):
    manifest(tmp_path)
    monkeypatch.setitem(gi.os.environ, "GEMINI_API_KEY", "test-only-key")
    body = {
        "candidates": [{"content": {"parts": [
            {"thought": True, "inlineData": {"mimeType": "image/jpeg", "data": "not-base64"}},
            {"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(OUTPUT_JPEG).decode("ascii")}},
        ]}}],
    }
    receipt = gi.execute_manifest(Path("manifest.json"), root=tmp_path, now=NOW,
                                  transport=lambda *_: Response(json.dumps(body).encode("utf-8")))
    assert receipt["status"] == "succeeded"
    assert (tmp_path / "out" / "g01-gemini-e01.jpg").read_bytes() == OUTPUT_JPEG


def test_receipt_and_dispatch_bind_manifest_bytes_loaded_before_transport_mutation(tmp_path, monkeypatch):
    path = manifest(tmp_path)
    original_sha = hashlib.sha256(path.read_bytes()).hexdigest()
    monkeypatch.setitem(gi.os.environ, "GEMINI_API_KEY", "test-only-key")

    def transport(_payload, _key):
        value = json.loads(path.read_text(encoding="utf-8"))
        value["request_id"] = "mutated-after-validation"
        path.write_text(json.dumps(gi.freeze_manifest(value)), encoding="utf-8")
        return response()

    receipt = gi.execute_manifest(Path("manifest.json"), root=tmp_path, now=NOW, transport=transport)
    journal = json.loads((tmp_path / "out" / "dispatch.json").read_text(encoding="utf-8"))
    assert receipt["manifest_sha256"] == original_sha
    assert journal["manifest_sha256"] == original_sha


def test_reservation_marker_refuses_second_manifest_before_credential_or_transport(tmp_path, monkeypatch):
    first = manifest(tmp_path, output_dir="out-a")
    monkeypatch.setitem(gi.os.environ, "GEMINI_API_KEY", "test-only-key")
    gi.execute_manifest(Path("manifest.json"), root=tmp_path, now=NOW, transport=lambda *_: response())
    value = json.loads(first.read_text(encoding="utf-8"))
    value["output"] = {"directory": "out-b", "candidate_stem": "g01-gemini-e01", "receipt": "out-b/receipt.json"}
    second = tmp_path / "second.json"; second.write_text(json.dumps(gi.freeze_manifest(value)), encoding="utf-8")
    with pytest.raises(gi.GeminiInputError, match="reservation dispatch marker"):
        gi.execute_manifest(Path("second.json"), root=tmp_path, now=NOW,
                            transport=lambda *_: pytest.fail("second transport called"))


def test_missing_credential_does_not_consume_reservation_marker(tmp_path, monkeypatch):
    manifest(tmp_path)
    monkeypatch.setattr(gi.os, "environ", {})
    with pytest.raises(gi.GeminiInputError, match="credential"):
        gi.execute_manifest(Path("manifest.json"), root=tmp_path, now=NOW,
                            transport=lambda *_: pytest.fail("transport called"))
    assert not (tmp_path / "_private" / "figment-gemini-input-dispatch").exists()


def test_missing_ambient_key_does_not_consume_reservation_marker(tmp_path, monkeypatch):
    manifest(tmp_path)
    monkeypatch.setattr(gi.os, "environ", {})
    with pytest.raises(gi.GeminiInputError, match="ambient Gemini credential"):
        gi.execute_manifest(Path("manifest.json"), root=tmp_path, now=NOW,
                            transport=lambda *_: pytest.fail("transport called"))
    assert not (tmp_path / "_private" / "figment-gemini-input-dispatch").exists()


def test_dispatch_refuses_reparse_output_at_write_time_before_transport(tmp_path, monkeypatch):
    manifest(tmp_path)
    monkeypatch.setitem(gi.os.environ, "GEMINI_API_KEY", "test-only-key")
    original = gi._is_reparse
    out = tmp_path / "out"

    def reparse(path):
        return path == out or original(path)

    monkeypatch.setattr(gi, "_is_reparse", reparse)
    with pytest.raises(gi.GeminiInputError, match="reparse"):
        gi.execute_manifest(Path("manifest.json"), root=tmp_path, now=NOW,
                            transport=lambda *_: pytest.fail("transport called"))
    assert not out.exists()


def test_response_and_output_bounds_refuse_and_do_not_retry(tmp_path, monkeypatch):
    manifest(tmp_path)
    monkeypatch.setitem(gi.os.environ, "GEMINI_API_KEY", "test-only-key")
    calls = []

    def transport(*_args):
        calls.append(1)
        return Response(b"x", headers={"content-length": str(gi.MAX_RESPONSE_BYTES + 1)})

    with pytest.raises(gi.GeminiInputError, match="byte limit"):
        gi.execute_manifest(Path("manifest.json"), root=tmp_path, now=NOW, transport=transport)
    assert calls == [1]
    assert json.loads((tmp_path / "out" / "receipt.json").read_text())["status"] == "unconfirmed"


def test_returned_image_requires_reviewed_wide_2k_16_9_envelope(tmp_path, monkeypatch):
    manifest(tmp_path)
    monkeypatch.setitem(gi.os.environ, "GEMINI_API_KEY", "test-only-key")
    smaller = jpeg(2048, 1152)
    with pytest.raises(gi.GeminiInputError, match="wide 2K"):
        gi.execute_manifest(Path("manifest.json"), root=tmp_path, now=NOW,
                            transport=lambda *_: response(smaller))
    receipt = json.loads((tmp_path / "out" / "receipt.json").read_text(encoding="utf-8"))
    assert receipt["status"] == "unconfirmed"
    assert not list((tmp_path / "out").glob("*.jpg"))


def test_wide_2k_envelope_accepts_reviewed_sizes_and_refuses_4k():
    assert gi._is_wide_2k_16_9((2752, 1536))
    assert gi._is_wide_2k_16_9((2816, 1536))
    assert not gi._is_wide_2k_16_9((4096, 2304))
    assert not gi._is_wide_2k_16_9((2752, 2048))


def test_existing_candidate_or_receipt_refuses_before_credential_or_transport(tmp_path, monkeypatch):
    manifest(tmp_path)
    out = tmp_path / "out"
    out.mkdir()
    (out / "g01-gemini-e01.jpg").write_bytes(b"old")
    monkeypatch.setattr(gi.os, "environ", {})
    with pytest.raises(gi.GeminiInputError, match="fresh"):
        gi.execute_manifest(Path("manifest.json"), root=tmp_path, now=NOW, transport=lambda *_: pytest.fail("transport called"))


def test_held_reservation_row_is_exact_and_counted_once(tmp_path):
    ledger = tmp_path / "ledger"
    ledger.mkdir()
    path = ledger / "figment-gemini-2026-09-08.tsv"
    header = "model\tstep\tusd\trequest_id\treservation_ref\tstate\n"
    row = "gemini-3-pro-image\tgemini-input-diagnostic\t4.600000\tgemini-e01-001\treserve-001\treserved\n"
    path.write_text(header + row, encoding="utf-8")
    assert gi._held_reservation(ledger, request_id="gemini-e01-001", reservation_ref="reserve-001", day="2026-09-08") == path
    path.write_text(header + row + row, encoding="utf-8")
    with pytest.raises(gi.GeminiInputError, match="exactly one"):
        gi._held_reservation(ledger, request_id="gemini-e01-001", reservation_ref="reserve-001", day="2026-09-08")
