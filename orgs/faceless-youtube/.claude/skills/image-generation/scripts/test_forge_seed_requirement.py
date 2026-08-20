import json
import ssl
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import forge

KIT = Path(__file__).resolve().parents[4] / "channels" / "the-second-take" / "visual-kit"


def test_nano_sends_explicit_1k_image_size(monkeypatch):
    captured = {}

    class Response:
        def __enter__(self): return self
        def __exit__(self, *_): return False

    def fake_open(req, **_kwargs):
        captured.update(json.loads(req.data.decode("utf-8")))
        response = Response()
        response.read = lambda: b""
        return response

    monkeypatch.setattr(forge.urllib.request, "urlopen", fake_open)
    monkeypatch.setattr(forge.json, "load", lambda _r: {
        "candidates": [{"content": {"parts": [{"inlineData": {"data": "aW1hZ2U="}}]}}]})
    assert forge.nano("https://unused.invalid", [{"text": "x"}], "16:9",
                      ssl.create_default_context()) == b"image"
    assert captured["generationConfig"]["imageConfig"]["imageSize"] == "1K"


def test_missing_kit_fails_clear_before_key_or_api_read(tmp_path):
    with pytest.raises(SystemExit, match="missing visual kit"):
        forge.Kit(str(tmp_path / "no-kit"), dry=False)


@pytest.mark.parametrize("declared", [None, ""])
def test_locked_tst_batch_accepts_empty_or_absent_suffix(tmp_path, declared):
    kit = forge.Kit(str(KIT), dry=True)
    kit.root = str(KIT.parents[2])
    doc = {"schema": "shots/1", "channel": "the-second-take",
           "long_form": {"shots": []}}
    if declared is not None:
        doc["global_prompt_suffix"] = declared
    shots = tmp_path / "shots.json"
    shots.write_text(json.dumps(doc), encoding="utf-8")
    forge.cmd_batch(kit, str(shots), str(tmp_path / "out.json"), video_dir=str(tmp_path))
