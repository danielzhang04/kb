"""Local wake-word listener (openwakeword 0.6.0, pretrained "hey jarvis" for V0).

Always-on, on-device: it reads the mic in 80 ms / 1280-sample frames at 16 kHz and never
sends audio anywhere — the only thing that leaves this module is the `on_wake()` call when
the wake score crosses threshold. Audio only leaves the PC AFTER wake, via the Deepgram STT
stream that app.py opens on the engagement transition (spec §2 Listening decision).

openwakeword facts (installed 0.6.0, verified against site-packages):
- `Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")`. tflite_runtime is NOT
  installed in atlas/.venv; onnxruntime is — so onnx is the working framework.
- Model names: the pretrained key is `hey_jarvis` (file hey_jarvis_v0.1.onnx). The loader does
  `name.replace(" ", "_")` when matching, so "hey jarvis" and "hey_jarvis" both resolve; we use
  the underscore form from config (`wake_model`).
- `model.predict(frame)` -> dict keyed by model name, e.g. {"hey_jarvis": 0.83}. Trigger at > 0.5.
- One-time model download performed into the default openwakeword cache
  (site-packages/openwakeword/resources/models) via openwakeword.utils.download_models(["hey_jarvis"]);
  ensure_models() below re-runs it idempotently if the onnx files are missing.
"""
import os
from typing import Callable

FRAME_SAMPLES = 1280   # 80 ms @ 16 kHz — openwakeword's expected chunk
SAMPLE_RATE = 16000
THRESHOLD = 0.5


def ensure_models(model_name: str) -> None:
    """Idempotently fetch the pretrained onnx model + feature models into the default cache."""
    import openwakeword
    models_dir = os.path.join(os.path.dirname(openwakeword.__file__), "resources", "models")
    needed = ["melspectrogram.onnx", "embedding_model.onnx", f"{model_name}_v0.1.onnx"]
    if all(os.path.exists(os.path.join(models_dir, f)) for f in needed):
        return
    from openwakeword.utils import download_models
    download_models([model_name])


def load_model(model_name: str):
    """Build an openwakeword Model for a single pretrained wake word (onnx framework)."""
    ensure_models(model_name)
    from openwakeword.model import Model
    return Model(wakeword_models=[model_name], inference_framework="onnx")


def listen(on_wake: Callable[[], None], model_name: str = "hey_jarvis") -> None:
    """Blocking mic loop: read 1280-sample int16 frames at 16 kHz, score each with the wake
    model, and call on_wake() whenever the score crosses THRESHOLD. Runs until interrupted."""
    import sounddevice as sd

    model = load_model(model_name)
    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16",
                        blocksize=FRAME_SAMPLES) as stream:
        while True:
            frame, _ = stream.read(FRAME_SAMPLES)
            scores = model.predict(frame[:, 0])
            if scores.get(model_name, 0.0) > THRESHOLD:
                on_wake()
