#!/usr/bin/env python3
"""Precompute: audio-only download + Demucs vocal/residual separation, cached per video id.

The HEAVY, sequential, one-time step (G2 audio-only; G5 idempotent + content-addressed). Kept OUT of
the fan-out so the per-video analysis workers stay light (Demucs on CPU is minutes/track — the pitfall).

  yt-dlp -x mp3  ->  htdemucs --two-stems=vocals --mp3  ->  <stems_dir>/<id>/{mix,vocal,residual}.mp3

Format = mp3 (NOT wav) ON PURPOSE: torchaudio 2.11 routes `.wav` saving through torchcodec, which is not
installed on this box (Windows) and crashes demucs at the save step. `--mp3` uses demucs's own lameenc
encoder (installed) and sidesteps torchaudio entirely. mp3@320k is transparent to our measures (librosa
loads it; RMS/onset/ebur128 are unaffected at that bitrate). Stems + mix are gitignored (G8).

  mix.mp3      — the full track (for whole-video ebur128 loudness)
  vocal.mp3    — the VO stem (speech regions / gaps / ducking reference)
  residual.mp3 — music + SFX (music presence/dips + onset density; the residual SFX+music stay tangled)

Idempotent: if all three exist for an id, it is skipped. NEVER pulls video (G2).

Usage:
  py -3 fetch_stems.py <video_id>       # one video (smoke)
  py -3 fetch_stems.py --all            # every videos.json entry, sequentially
  py -3 fetch_stems.py <video_id> --force
"""
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
SCRIPT_DIR = Path(__file__).resolve().parent
VIDEOS_JSON = SCRIPT_DIR / "videos.json"
MP3_BITRATE = "320"


def _cfg():
    return json.loads(VIDEOS_JSON.read_text(encoding="utf-8"))


def _stems_dir(cfg):
    return REPO_ROOT / cfg["stems_dir"]


def _entry(cfg, vid):
    for v in cfg["videos"]:
        if v["id"] == vid:
            return v
    raise SystemExit(f"video id not in videos.json: {vid}")


def _run(cmd, **kw):
    """Run a child process, streaming its output; raise on non-zero."""
    print(f"  $ {' '.join(str(c) for c in cmd)}", flush=True)
    subprocess.run(cmd, check=True, **kw)


def fetch_one(vid, cfg, force=False):
    """Download the mix + separate into vocal/residual stems; cache under <stems_dir>/<id>/. Idempotent."""
    entry = _entry(cfg, vid)
    out_dir = _stems_dir(cfg) / vid
    mix, vocal, residual = out_dir / "mix.mp3", out_dir / "vocal.mp3", out_dir / "residual.mp3"
    if mix.exists() and vocal.exists() and residual.exists() and not force:
        print(f"[skip] {vid} ({entry['slug']}) — stems already cached", flush=True)
        return {"id": vid, "status": "cached"}

    out_dir.mkdir(parents=True, exist_ok=True)
    work = out_dir / "_work"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir()
    url = entry.get("url") or f"https://www.youtube.com/watch?v={vid}"
    src = work / f"{vid}.mp3"
    t0 = time.time()

    # 1) audio-only extract to mp3 (G2: -x, never the video stream)
    _run(["yt-dlp", "-x", "--audio-format", "mp3", "--audio-quality", "0",
          "-o", str(work / f"{vid}.%(ext)s"), url])
    if not src.exists():
        raise SystemExit(f"yt-dlp produced no mp3 for {vid} (expected {src})")
    t_dl = time.time() - t0

    # 2) Demucs two-stem (vocals vs the rest) on CPU, mp3 out (lameenc — no torchaudio/torchcodec)
    #    -> <work>/htdemucs/<id>/{vocals,no_vocals}.mp3
    _run([sys.executable, "-m", "demucs", "--two-stems=vocals", "-n", "htdemucs",
          "--mp3", "--mp3-bitrate", MP3_BITRATE, "-d", "cpu", "-o", str(work), str(src)])
    sep = work / "htdemucs" / vid
    src_vocal, src_resid = sep / "vocals.mp3", sep / "no_vocals.mp3"
    if not (src_vocal.exists() and src_resid.exists()):
        raise SystemExit(f"demucs output missing for {vid}: {sep}")

    shutil.move(str(src), str(mix))            # keep the full mix for whole-video loudness
    shutil.move(str(src_vocal), str(vocal))
    shutil.move(str(src_resid), str(residual))
    shutil.rmtree(work)
    t_total = time.time() - t0
    dur = entry.get("dur_s") or 0
    rt = (t_total / dur) if dur else 0.0
    print(f"[done] {vid} ({entry['slug']}) — dl {t_dl:.0f}s · total {t_total:.0f}s "
          f"· {rt:.2f}x realtime (audio {dur}s)", flush=True)
    return {"id": vid, "status": "fresh", "seconds": round(t_total, 1), "realtime_x": round(rt, 2)}


def main(argv):
    cfg = _cfg()
    force = "--force" in argv
    args = [a for a in argv if not a.startswith("--")]
    if "--all" in argv:
        results = [fetch_one(v["id"], cfg, force) for v in cfg["videos"]]
        print("\nSUMMARY:", flush=True)
        for r in results:
            print(f"  {r['id']:14} {r['status']:6} "
                  f"{(str(r.get('seconds', ''))+'s') if r.get('seconds') else ''}", flush=True)
        return
    if not args:
        raise SystemExit(__doc__)
    fetch_one(args[0], cfg, force)


if __name__ == "__main__":
    main(sys.argv[1:])
