from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image


TRAIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TRAIN))
import identity_observe as observe  # noqa: E402


@pytest.fixture(autouse=True)
def _pinned_opencv_metadata(monkeypatch):
    monkeypatch.setattr(observe.importlib.metadata, "version", lambda _package: "4.12.0.88")


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write_image(path: Path, value: int = 0) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 6), (value, value, value)).save(path)


def _pins(model_bytes: dict[str, bytes], *, admission: str = "admitted") -> dict:
    return {
        "schema": observe.PIN_SCHEMA,
        "admission": admission,
        "runtime": {
            "package": "opencv-python-headless", "version": "4.12.0.88", "wheel": "x.whl",
            "python_abi": "cp37-abi3", "platform": "win_amd64", "sha256": "a" * 64,
            "license": "Apache-2.0", "source": "https://example.test/pypi",
        },
        "models": [
            {
                "id": "detector", "role": "face_detector", "filename": "detector.onnx", "format": "onnx",
                "bytes": len(model_bytes["detector.onnx"]), "sha256": _sha(model_bytes["detector.onnx"]),
                "source_repository": "https://example.test/detector", "source_revision": "b" * 40,
                "source_path": "detector.onnx", "license": "MIT", "license_source": "https://example.test/license",
            },
            {
                "id": "recognizer", "role": "face_recognizer", "filename": "recognizer.onnx", "format": "onnx",
                "bytes": len(model_bytes["recognizer.onnx"]), "sha256": _sha(model_bytes["recognizer.onnx"]),
                "source_repository": "https://example.test/recognizer", "source_revision": "c" * 40,
                "source_path": "recognizer.onnx", "license": "Apache-2.0", "license_source": "https://example.test/license",
            },
        ],
    }


def _fixture_root(tmp_path: Path) -> tuple[Path, dict, str]:
    model_bytes = {"detector.onnx": b"detector-model", "recognizer.onnx": b"recognizer-model"}
    for name, data in model_bytes.items():
        target = tmp_path / "models" / name
        target.parent.mkdir(exist_ok=True)
        target.write_bytes(data)
    _write_image(tmp_path / "candidate.png", 1)
    _write_image(tmp_path / "anchors" / "g01.png", 2)
    pins = _pins(model_bytes)
    encoded = json.dumps(pins).encode("utf-8")
    return tmp_path, pins, _sha(encoded)


class _Detector:
    def __init__(self, mode: str):
        self.mode = mode
        self.sizes: list[tuple[int, int]] = []

    def setInputSize(self, size):
        self.sizes.append(tuple(size))

    def detect(self, image):
        face = np.array([[1, 1, 4, 4, 1, 1, 4, 1, 2, 2, 1, 4, 4, 4, 0.95]], dtype=np.float32)
        if self.mode == "none":
            return None, None
        if self.mode == "multi":
            return None, np.concatenate([face, face])
        return None, face


class _Recognizer:
    def __init__(self):
        self.align_calls: list[tuple[tuple[int, ...], list[float]]] = []

    def alignCrop(self, image, face):
        self.align_calls.append((tuple(image.shape), [float(value) for value in list(face)]))
        return image

    def feature(self, image):
        return np.array([[3.0, 4.0]], dtype=np.float32)


def _backend(mode: str = "one", shape: tuple[int, int] = (6, 8)):
    detector = _Detector(mode)
    recognizer = _Recognizer()
    return SimpleNamespace(
        __version__="4.12.0",
        IMREAD_COLOR=1,
        INTER_AREA=3,
        imdecode=lambda _data, _mode: np.zeros((*shape, 3), dtype=np.uint8),
        resize=lambda _image, size, interpolation: np.zeros((size[1], size[0], 3), dtype=np.uint8),
        FaceDetectorYN=SimpleNamespace(create=lambda *_args: detector),
        FaceRecognizerSF=SimpleNamespace(create=lambda *_args: recognizer),
        detector=detector,
        recognizer=recognizer,
    )


def _run(tmp_path: Path, pins: dict, pins_sha: str, backend, *, out: str = "result.json", detector_preprocessing: str | None = None) -> dict:
    return observe._observe_with_backend(
        root=observe._safe_root(tmp_path), model_dir="models", image_path="candidate.png",
        anchor_paths=["anchors/g01.png"], output_path=out, pins=pins, pins_sha256=pins_sha, cv2=backend,
        detector_preprocessing=detector_preprocessing,
    )


def test_checked_in_pins_are_admitted_precise_and_safe_format():
    pins, _ = observe._load_pins()
    assert pins["admission"] == "admitted"
    assert pins["runtime"]["wheel"].endswith("cp37-abi3-win_amd64.whl")
    assert {model["format"] for model in pins["models"]} == {"onnx"}
    assert all(len(model["source_revision"]) == 40 for model in pins["models"])


def test_pending_pins_refuse_before_model_or_opencv_session(tmp_path: Path, monkeypatch):
    root, pins, _ = _fixture_root(tmp_path)
    pins["admission"] = "pending-independent-review"
    manifest = root / "pins.json"
    manifest.write_text(json.dumps(pins), encoding="utf-8")
    monkeypatch.setattr(observe, "_load_pins", lambda: (pins, "0" * 64))
    with pytest.raises(observe.IdentityObserveError, match="pending independent review"):
        observe.observe(root=root, model_dir="models", image_path="candidate.png", anchor_paths=["anchors/g01.png"], output_path="result.json")
    assert not (root / "result.json").exists()


def test_invalid_source_revision_is_rejected_before_observation(tmp_path: Path):
    root, pins, _ = _fixture_root(tmp_path)
    pins["models"][0]["source_revision"] = "short"
    manifest = root / "pins.json"
    manifest.write_text(json.dumps(pins), encoding="utf-8")
    with pytest.raises(observe.IdentityObserveError, match="source_revision"):
        observe._load_pins(manifest)


def test_model_hash_mismatch_stops_before_backend_use(tmp_path: Path):
    root, pins, pins_sha = _fixture_root(tmp_path)

    class MustNotRun:
        IMREAD_COLOR = 1

        def __getattr__(self, _name):
            raise AssertionError("backend must not be used before model verification")

    (root / "models" / "detector.onnx").write_bytes(b"changed")
    with pytest.raises(observe.IdentityObserveError, match="does not match"):
        _run(root, pins, pins_sha, MustNotRun())


def test_runtime_distribution_and_cv2_version_must_match_pin(tmp_path: Path, monkeypatch):
    _root, pins, _pins_sha = _fixture_root(tmp_path)
    backend = _backend()
    monkeypatch.setattr(observe.importlib.metadata, "version", lambda _package: "4.13.0.1")
    with pytest.raises(observe.IdentityObserveError, match="distribution version mismatch"):
        observe._verify_runtime(backend, pins)
    monkeypatch.setattr(observe.importlib.metadata, "version", lambda _package: "4.12.0.88")
    backend.__version__ = "4.13.0"
    with pytest.raises(observe.IdentityObserveError, match="cv2 runtime version"):
        observe._verify_runtime(backend, pins)


@pytest.mark.parametrize(("mode", "reason"), [("none", "no face"), ("multi", "multiple faces")])
def test_no_or_multiple_face_writes_unavailable_raw_observation(tmp_path: Path, mode: str, reason: str):
    root, pins, pins_sha = _fixture_root(tmp_path)
    result = _run(root, pins, pins_sha, _backend(mode))
    assert result["candidate"]["face"] is None
    assert reason in result["candidate"]["unavailable_reason"]
    assert result["anchors"][0]["raw_cosine"] is None
    assert json.loads((root / "result.json").read_text()) == result


def test_exactly_one_face_records_raw_cosine_landmarks_and_hashes_only(tmp_path: Path):
    root, pins, pins_sha = _fixture_root(tmp_path)
    backend = _backend()
    result = _run(root, pins, pins_sha, backend)
    assert result["candidate"]["face"]["confidence"] == pytest.approx(0.95)
    assert len(result["candidate"]["face"]["landmarks"]) == 5
    assert result["anchors"][0]["raw_cosine"] == pytest.approx(1.0)
    assert result["candidate"]["source_before"] == result["candidate"]["source_after"]
    assert result["anchors"][0]["source_before"] == result["anchors"][0]["source_after"]
    serialized = json.dumps(result).lower()
    assert '"pass"' not in serialized and '"embedding"' not in serialized and '"threshold"' not in serialized
    assert backend.detector.sizes == [(8, 6), (8, 6)]
    runtime = result["model_pins"]["runtime"]
    assert runtime["verified_runtime"] == {"distribution_version": "4.12.0.88", "cv2_version": "4.12.0"}
    assert runtime["backend"] == "opencv-dnn-cpu"
    assert runtime["detector_parameters"]["top_k"] == 5000
    assert result["schema"] == observe.SCHEMA
    assert "detector_preprocessing" not in result["candidate"]


def test_fixed640_non_square_maps_detector_coordinates_to_original_pixels_for_sface(tmp_path: Path):
    root, pins, pins_sha = _fixture_root(tmp_path)
    backend = _backend(shape=(1001, 2003))
    result = _run(root, pins, pins_sha, backend, detector_preprocessing=observe.FIXED640_PREPROCESSING)
    candidate = result["candidate"]
    metadata = candidate["detector_preprocessing"]
    assert result["schema"] == observe.FIXED640_SCHEMA
    assert metadata["id"] == observe.FIXED640_PREPROCESSING
    assert metadata["original_size"] == {"width": 2003, "height": 1001}
    assert metadata["detector_input_size"] == {"width": 640, "height": 320}
    assert metadata["sx"] == pytest.approx(640 / 2003)
    assert metadata["sy"] == pytest.approx(320 / 1001)
    assert metadata["interpolation"] == "INTER_AREA"
    assert metadata["resized"] is True
    assert candidate["face"]["bbox"]["x"] == pytest.approx(1 / metadata["sx"])
    assert candidate["face"]["bbox"]["y"] == pytest.approx(1 / metadata["sy"])
    assert metadata["mapped_face"] == candidate["face"]
    assert metadata["detector_face"]["bbox"]["x"] == pytest.approx(1.0)
    anchor_metadata = result["anchors"][0]["detector_preprocessing"]
    assert anchor_metadata["detector_input_size"] == {"width": 640, "height": 320}
    assert backend.detector.sizes == [(640, 320), (640, 320)]
    assert all(shape == (1001, 2003, 3) for shape, _face in backend.recognizer.align_calls)
    assert backend.recognizer.align_calls[0][1][0] == pytest.approx(1 / metadata["sx"])


def test_fixed640_never_upscales_small_inputs_and_preserves_anchor_metadata(tmp_path: Path):
    root, pins, pins_sha = _fixture_root(tmp_path)
    backend = _backend()
    result = _run(root, pins, pins_sha, backend, detector_preprocessing=observe.FIXED640_PREPROCESSING)
    for item in [result["candidate"], *result["anchors"]]:
        metadata = item["detector_preprocessing"]
        assert metadata["original_size"] == {"width": 8, "height": 6}
        assert metadata["detector_input_size"] == {"width": 8, "height": 6}
        assert metadata["sx"] == 1.0 and metadata["sy"] == 1.0
        assert metadata["resized"] is False
        assert metadata["recognizer_pixels"] == "original"


@pytest.mark.parametrize(("mode", "reason"), [("none", "no face"), ("multi", "multiple faces")])
def test_fixed640_preserves_exactly_one_face_rule_and_records_anchor_null_metadata(tmp_path: Path, mode: str, reason: str):
    root, pins, pins_sha = _fixture_root(tmp_path)
    result = _run(root, pins, pins_sha, _backend(mode), detector_preprocessing=observe.FIXED640_PREPROCESSING)
    assert result["candidate"]["face"] is None
    assert result["candidate"]["detector_preprocessing"]["face_count"] == (0 if mode == "none" else 2)
    anchor = result["anchors"][0]
    assert anchor["raw_cosine"] is None
    assert anchor["detector_preprocessing"]["id"] == observe.FIXED640_PREPROCESSING
    assert reason in anchor["detector_unavailable_reason"]


def test_invalid_detector_preprocessing_is_rejected_before_model_work(tmp_path: Path):
    root, pins, pins_sha = _fixture_root(tmp_path)
    with pytest.raises(observe.IdentityObserveError, match="detector_preprocessing"):
        _run(root, pins, pins_sha, _backend(), detector_preprocessing="resize-until-it-works")


def test_second_image_read_is_bounded_when_source_grows(tmp_path: Path, monkeypatch):
    root, _pins, _pins_sha = _fixture_root(tmp_path)
    monkeypatch.setattr(observe, "MAX_IMAGE_BYTES", 100)
    original = observe._hash_file

    def grow_after_hash(root_value, value, label, maximum):
        result = original(root_value, value, label, maximum)
        if label == "candidate image":
            (root / "candidate.png").write_bytes(b"x" * 101)
        return result

    monkeypatch.setattr(observe, "_hash_file", grow_after_hash)
    with pytest.raises(observe.IdentityObserveError, match="exceeds"):
        observe._image_bytes(observe._safe_root(root), "candidate.png", "candidate image")


def test_model_change_after_session_work_prevents_receipt(tmp_path: Path):
    root, pins, pins_sha = _fixture_root(tmp_path)
    backend = _backend()
    original = backend.detector.detect

    def mutate_model(image):
        (root / "models" / "detector.onnx").write_bytes(b"replaced")
        return original(image)

    backend.detector.detect = mutate_model
    with pytest.raises(observe.IdentityObserveError, match="model changed"):
        _run(root, pins, pins_sha, backend)
    assert not (root / "result.json").exists()


def test_nonfinite_cosine_is_rejected_before_json_encoding():
    with pytest.raises(observe.IdentityObserveError, match="non-finite cosine"):
        observe._cosine([1.0], [float("nan")])


@pytest.mark.parametrize("unsafe", ["../candidate.png", "C:/outside.png", "anchors/../g01.png"])
def test_root_relative_inputs_and_fresh_output_are_enforced(tmp_path: Path, unsafe: str):
    root, pins, pins_sha = _fixture_root(tmp_path)
    with pytest.raises(observe.IdentityObserveError, match="root-relative"):
        observe._observe_with_backend(
            root=observe._safe_root(root), model_dir="models", image_path=unsafe,
            anchor_paths=["anchors/g01.png"], output_path="result.json", pins=pins, pins_sha256=pins_sha, cv2=_backend(),
        )
    (root / "result.json").write_text("existing", encoding="utf-8")
    with pytest.raises(observe.IdentityObserveError, match="fresh"):
        _run(root, pins, pins_sha, _backend())


def test_reparse_component_is_refused_before_containment(tmp_path: Path, monkeypatch):
    root, _pins, _pins_sha = _fixture_root(tmp_path)
    safe_root = observe._safe_root(root)
    monkeypatch.setattr(observe, "_is_reparse", lambda path: path.name == "linked")
    with pytest.raises(observe.IdentityObserveError, match="symlink or reparse"):
        observe._within(safe_root, "linked/g01.png", "anchor image")
