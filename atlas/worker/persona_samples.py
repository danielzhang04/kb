"""Atlas V0 persona bake-off sample generator (Task 8, 2-way: Deepgram Aura-2 vs ElevenLabs).

Synthesizes the 3 fixed lines from atlas.yaml `persona_lines` (a status report, a completion
callback, an approval readback — spec §10 types; text authored here, see the yaml note) across the
6 candidate voices in `persona_candidates` (3 Aura-2 + 3 ElevenLabs stock, spanning butler /
chief-of-staff / casual). Output → .superpowers/sdd/t8-staging/persona-samples/ for an ear-test at
the V0 checkpoint. 18 files total.

  - Deepgram Aura-2 : livekit deepgram plugin, linear16 @ 24 kHz -> wrapped as .wav
                      (voice encoded in the model string aura-2-<voice>-en; rides the $200 credit)
  - ElevenLabs      : /v1/text-to-speech REST (eleven_turbo_v2_5) -> .mp3
                      (stock voice_ids; draws Daniel's existing paid subscription quota)

Filenames: <vendor>-<voice>-<line-id>.{wav,mp3}, e.g. deepgram-draco-1-status-report.wav

Run (from atlas/):  .venv\\Scripts\\python -m worker.persona_samples
Needs DEEPGRAM_API_KEY + ELEVENLABS_API_KEY in %USERPROFILE%\\.atlas\\env.
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import urllib.request
import wave
from pathlib import Path

import yaml

from worker import repl

ATLAS = Path(__file__).resolve().parents[1]
# Staging lives at the WORKTREE ROOT .superpowers/sdd (gitignored `*`), not the nested atlas/ one.
OUT = ATLAS.parent / ".superpowers" / "sdd" / "t8-staging" / "persona-samples"
TTS_SR = 24000


def _cfg() -> dict:
    return yaml.safe_load((ATLAS / "config" / "atlas.yaml").read_text(encoding="utf-8"))


def _pcm_to_wav(pcm: bytes, sample_rate: int = TTS_SR) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)          # linear16
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()


async def _deepgram_samples(voices: list[dict], lines: list[dict]) -> list[Path]:
    from livekit.agents.utils import http_context
    from livekit.plugins import deepgram

    written: list[Path] = []
    async with http_context.open():
        for v in voices:
            tts = deepgram.TTS(model=v["model"], encoding="linear16", sample_rate=TTS_SR)
            for ln in lines:
                pcm = bytearray()
                async for ev in tts.synthesize(ln["text"]):
                    pcm += bytes(ev.frame.data)
                path = OUT / f"deepgram-{v['voice']}-{ln['id']}.wav"
                path.write_bytes(_pcm_to_wav(bytes(pcm)))
                written.append(path)
                print(f"  deepgram {v['voice']:<10} {ln['id']:<22} {len(path.read_bytes()):>7} B")
            await tts.aclose()
    return written


def _elevenlabs_samples(voices: list[dict], lines: list[dict], model_id: str) -> list[Path]:
    key = os.environ["ELEVENLABS_API_KEY"]
    written: list[Path] = []
    for v in voices:
        for ln in lines:
            body = json.dumps({"text": ln["text"], "model_id": model_id}).encode("utf-8")
            req = urllib.request.Request(
                f"https://api.elevenlabs.io/v1/text-to-speech/{v['voice_id']}",
                data=body,
                headers={"xi-api-key": key, "Content-Type": "application/json",
                         "Accept": "audio/mpeg"},
                method="POST",
            )
            audio = urllib.request.urlopen(req, timeout=60).read()
            path = OUT / f"elevenlabs-{v['voice']}-{ln['id']}.mp3"
            path.write_bytes(audio)
            written.append(path)
            print(f"  elevenlabs {v['voice']:<10} {ln['id']:<22} {len(audio):>7} B")
    return written


def main() -> int:
    repl.load_env()
    cfg = _cfg()
    lines = cfg["persona_lines"]
    cand = cfg["persona_candidates"]
    OUT.mkdir(parents=True, exist_ok=True)

    print(f"Deepgram Aura-2 ({len(cand['deepgram'])} voices x {len(lines)} lines):")
    dg = asyncio.run(_deepgram_samples(cand["deepgram"], lines))
    print(f"ElevenLabs ({len(cand['elevenlabs'])} voices x {len(lines)} lines):")
    el = _elevenlabs_samples(cand["elevenlabs"], lines, cand["elevenlabs_model"])

    total = dg + el
    print(f"\nwrote {len(total)} samples to {OUT}")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
