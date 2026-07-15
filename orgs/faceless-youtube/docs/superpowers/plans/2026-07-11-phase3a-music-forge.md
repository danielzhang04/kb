# Phase 3A — `music-forge` (Music Sourcing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the niche-agnostic `music-forge` skill — it sources casual-comedic music (the Crayon idiom) by mood bucket, vets it objectively (loop-ability + loudness + duration), CLAP-ranks it, emits an audition board (the human checkpoint), and wires the human's picks into the channel's `audio-tokens.json music_pools`.

**Architecture:** A **source-agnostic core** — `board` (vet + CLAP-rank every candidate in `audio/incoming/<bucket>/`) and `pick` (loudness-normalize the chosen into `audio/beds/` + wire `music_pools`) — fed by an **Incompetech fetcher** (Kevin MacLeod, CC-BY: the actual comedic-explainer catalog, direct-mp3-downloadable, verified). The core reuses sfx-forge's generic leaf modules (`vet.probe`, `rank`) and adds only what music needs: a casual-comedic taxonomy (`music-buckets.json`), loop-ability vetting (`music_vet.py`), and the fetch/board/pick orchestrator. Because the core reads a directory, other sources (manual YouTube-Audio-Library drops; a Freesound lo-fi pass) populate the same `incoming/` folder with zero core changes.

**Tech Stack:** Python 3.13 (`py -3`), plain-`assert` tests (repo convention). Incompetech direct mp3 (CC-BY), CLAP (`laion/clap-htsat-unfused`, already downloaded), librosa, ffmpeg/ffprobe (`ebur128` loudnorm + `astats`). `urllib` for downloads (no key needed).

## Global Constraints

Every task implicitly includes these (from the spec `2026-07-11-phase3-music-lane-arc-design.md`, guards G1–G9):

- **G1 — Explicit-path commits.** `git add <exact paths>`; NEVER `git add -A`; never rewrite history. Parallel terminals share this tree.
- **G2 — Ear-gate checkpoints.** Claude runs the audition; the pick + taxonomy are the human's call. Do NOT self-select tracks.
- **G3 — Data, not logic.** Mood taxonomy, Incompetech seed lists, CLAP prompts, duration bands, `music_norm_lufs`, and `music_pools` are DATA (`music-buckets.json` / `audio-tokens.json`). The scripts stay general.
- **G4 — Reuse, don't duplicate.** Import `vet.probe`, `rank` from `../../sfx-forge/scripts` (self-contained leaf modules — no ROOT dependency). Do NOT copy or fork them.
- **G5 — Single-sourced config.** `music-buckets.json` is the ONLY home for sourcing config; final pools live in `audio-tokens.json`. SKILL.md points to files, doesn't restate their contents.
- **G6 — Objective vet, human taste.** Vetting is MECHANICAL (duration / clip / loudness / loop-ability). CLAP `quality`/`clap` scores RANK; they never substitute for the human pick.
- **G7 — Skills do the work.** The library is produced by the skill; no hand-placed mp3s. `_chain-test` etc. stay fixtures only.
- **G8 — Back-compat + resilient.** A failed download/probe skips one candidate, never crashes a run. License is CC-BY (Kevin MacLeod) — a description credit is required (handled in `pick`).
- **G9 — Cost-modest, monetization-safe.** CC-BY (attribution) / CC0 only; free sources; reuse across videos. Casual-comedic idiom (NOT cinematic scoring) per the channel's Crayon-Capital reference.

**Source note (settled 2026-07-11):** the spec's ideal source list included Incompetech; a spike proved **Freesound lacks the comedic-production idiom** (rich in lo-fi/cinematic, empty on quirky-comedic), so v1 sources from **Incompetech** (CC-BY; direct mp3 at `https://incompetech.com/music/royalty-free/mp3-royaltyfree/<Track Name>.mp3`, verified on 4 tracks). YouTube Audio Library (free, monetization-safe, "Comedy" mood) is reachable by manual drop into the SAME `incoming/` folder. Freesound lo-fi stays an optional later texture source — out of scope here.

---

## File Structure

- **Create** `.claude/skills/music-forge/music-buckets.json` — the casual-comedic taxonomy + Incompetech seed lists + CLAP prompts (DATA; the A1 artifact).
- **Create** `.claude/skills/music-forge/scripts/music_vet.py` — loop-ability + music vetting (the one new mechanical module).
- **Create** `.claude/skills/music-forge/scripts/test_music_vet.py` — hermetic tests for the pure decision.
- **Create** `.claude/skills/music-forge/scripts/fetch_incompetech.py` — download seed tracks → `audio/incoming/<bucket>/` + provenance.
- **Create** `.claude/skills/music-forge/scripts/test_fetch_incompetech.py` — hermetic tests (URL builder, injected downloader).
- **Create** `.claude/skills/music-forge/scripts/music_forge.py` — orchestrator: `board` (vet→rank→audition over `incoming/`) + `pick` (loudnorm→beds→wire).
- **Create** `.claude/skills/music-forge/scripts/test_music_forge.py` — hermetic tests for the pure `collect_files` + `assemble_pools` seams.
- **Create** `.claude/skills/music-forge/SKILL.md` — orchestration doc (inputs · fetch→board→pick flow · ear-gate · scope).
- **Modify** `.claude/skills/README.md` — add `music-forge` to the roster (cross-file-consistent with CLAUDE.md).
- **Modify** `CLAUDE.md` — bump "Skills built (N)" +1; add `music-forge`; mark Phase-3A in the audio bullet (integrate-in-place).
- **Modify** `channels/the-second-take/visual-kit/audio-tokens.json` — add `music_pools` + `music_norm_lufs` scaffold.
- **Modify** `knowledge/decisions.md` — log the Phase-3A build + taxonomy + source pivot.

Imported (NOT modified): `.claude/skills/sfx-forge/scripts/{vet.py, rank.py}`.

---

## Task 1: A1 — casual-comedic taxonomy + `music-buckets.json` (🔒 CHECKPOINT)

**Files:** Create `.claude/skills/music-forge/music-buckets.json`

**Interfaces:**
- Produces: `{"defaults": {...}, "buckets": {<mood>: {"mood_use","incompetech_seeds":[names],"clap_prompts":[...],"dur_s":[lo,hi],"pick_n":n}}}`. `buckets` keys become `music_pools` mood keys; `incompetech_seeds` feed `fetch_incompetech`.

- [ ] **Step 1: Write `music-buckets.json`** (casual-comedic, the Crayon idiom — NO cinematic buckets; seeds are known Kevin MacLeod comedic-explainer tracks):

```json
{
  "_doc": "Music sourcing brief for music-forge. Bucket keys = the channel's CASUAL-COMEDIC mood taxonomy (spec 2026-07-11-phase3-music-lane-arc-design.md A1, Crayon-Capital idiom, NOT cinematic). Keys become audio-tokens.json music_pools keys; incompetech_seeds feed fetch_incompetech (CC-BY). dur_s = a loopable section length. This is the ONLY home for sourcing config; final beds live in audio/beds + music_pools.",
  "defaults": {
    "top_n": 6,
    "norm_lufs": -20.0,
    "incompetech_url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/{name}.mp3"
  },
  "buckets": {
    "casual-bed": {
      "mood_use": "DEFAULT workhorse bed — light, wry, walking-pace quirky groove under most narration",
      "incompetech_seeds": ["Pixelland", "Carefree", "The Builder", "Cipher", "Wallpaper", "Barroom Ballet", "Fluffing a Duck", "Faster Does It"],
      "clap_prompts": ["a light playful quirky background music", "a wry bouncy walking-pace comedic underscore"],
      "dur_s": [20, 220],
      "pick_n": 3
    },
    "upbeat": {
      "mood_use": "energetic playful lift — the fun/absurd money bits (still casual-comedic, not a fanfare)",
      "incompetech_seeds": ["Monkeys Spinning Monkeys", "The Show Must Be Go", "Life of Riley", "Cheery Monday", "Pina Colada", "Killers"],
      "clap_prompts": ["an upbeat cheerful playful comedic tune", "a bright bouncy happy underscore"],
      "dur_s": [20, 220],
      "pick_n": 2
    },
    "sneaky": {
      "mood_use": "light comedic tiptoe / mischief — the 'here's the con' stretches (quirky, NOT cinematic tension)",
      "incompetech_seeds": ["Sneaky Snitch", "Scheming Weasel faster", "Sneaky Adventure", "Investigations", "Covert Affair", "Clash Defiant"],
      "clap_prompts": ["a sneaky mischievous comedic tiptoe tune", "a playful quirky spy-caper underscore"],
      "dur_s": [20, 220],
      "pick_n": 2
    }
  }
}
```

- [ ] **Step 2: Validate it parses + shape is right.**
Run: `py -3 -c "import json; d=json.load(open('.claude/skills/music-forge/music-buckets.json',encoding='utf-8')); b=d['buckets']; assert all(set(v)>= {'mood_use','incompetech_seeds','clap_prompts','dur_s','pick_n'} for v in b.values()); print('buckets:', list(b))"`
Expected: `buckets: ['casual-bed', 'upbeat', 'sneaky']`

- [ ] **Step 3: Commit**
```bash
git add .claude/skills/music-forge/music-buckets.json
git commit -m "feat(music-forge): music-buckets.json — casual-comedic taxonomy (Crayon idiom, Incompetech seeds)"
```

> **🔒 CHECKPOINT (human — taxonomy approval, spec A1):** Present the three buckets + `mood_use` + a few seed track names. The user approves / edits the mood set + seeds (this is the casual-comedic reframe — confirm it reads as Crayon, not cinematic). Locking this unlocks sub-project B's task-plan. Tasks 2–6 (pure code + docs) may proceed in parallel; only Task 7 (the live fetch + ear-gate) waits on approval.

---

## Task 2: `music_vet.py` — loop-ability + music vetting (TDD)

**Files:** Create `.claude/skills/music-forge/scripts/music_vet.py`, `.../test_music_vet.py`

**Interfaces:**
- Consumes: `vet.probe(path) -> {"duration","peak_db","rms_db","lead_silence_s",...}` (from sfx-forge).
- Produces: `loop_features(path) -> {"head_rms_db","tail_rms_db","trail_silence_s"}` · `vet_music(base, loop, dur_lo, dur_hi) -> {"ok","reasons","quality"}` (PURE decision).

- [ ] **Step 1: Write the failing test** `test_music_vet.py`:
```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from music_vet import vet_music

def base(**kw):
    b = {"duration": 90.0, "peak_db": -1.5, "rms_db": -18.0, "lead_silence_s": 0.1}
    b.update(kw); return b

def loop(**kw):
    l = {"head_rms_db": -18.0, "tail_rms_db": -19.0, "trail_silence_s": 0.1}
    l.update(kw); return l

def test_clean_loopable_music_passes():
    v = vet_music(base(), loop(), 20, 220)
    assert v["ok"] is True and v["reasons"] == [], v

def test_too_short_rejected():
    v = vet_music(base(duration=8.0), loop(), 20, 220)
    assert v["ok"] is False and any("duration" in r for r in v["reasons"]), v

def test_too_long_rejected():
    v = vet_music(base(duration=400.0), loop(), 20, 220)
    assert v["ok"] is False and any("duration" in r for r in v["reasons"]), v

def test_clipping_rejected():
    v = vet_music(base(peak_db=0.0), loop(), 20, 220)
    assert v["ok"] is False and any("clip" in r for r in v["reasons"]), v

def test_near_silent_rejected():
    v = vet_music(base(rms_db=-50.0), loop(), 20, 220)
    assert v["ok"] is False and any("silent" in r for r in v["reasons"]), v

def test_fade_to_silence_tail_not_loopable():
    v = vet_music(base(), loop(trail_silence_s=1.5), 20, 220)
    assert v["ok"] is False and any("loop" in r for r in v["reasons"]), v

def test_head_tail_level_discontinuity_not_loopable():
    v = vet_music(base(), loop(head_rms_db=-12.0, tail_rms_db=-30.0), 20, 220)
    assert v["ok"] is False and any("loop" in r for r in v["reasons"]), v

def test_quality_rewards_continuity_and_loudness():
    tight = vet_music(base(rms_db=-14.0), loop(head_rms_db=-18.0, tail_rms_db=-18.0), 20, 220)
    loose = vet_music(base(rms_db=-14.0), loop(head_rms_db=-14.0, tail_rms_db=-20.0), 20, 220)
    assert tight["quality"] > loose["quality"], (tight, loose)

print("running")
test_clean_loopable_music_passes(); test_too_short_rejected(); test_too_long_rejected()
test_clipping_rejected(); test_near_silent_rejected(); test_fade_to_silence_tail_not_loopable()
test_head_tail_level_discontinuity_not_loopable(); test_quality_rewards_continuity_and_loudness()
print("PASS")
```

- [ ] **Step 2: Run → FAIL** (`ModuleNotFoundError: No module named 'music_vet'`).
Run: `py -3 .claude/skills/music-forge/scripts/test_music_vet.py`

- [ ] **Step 3: Implement `music_vet.py`:**
```python
#!/usr/bin/env python3
"""Objective MUSIC vetting for music-forge. Reuses sfx-forge's vet.probe() for base features and adds
loop-ability (a music bed must loop under a section without a click or a fade-out). vet_music() is a PURE
decision (testable); loop_features() is a thin ffmpeg wrapper. Vetting is MECHANICAL, never taste (G6)."""
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sfx-forge" / "scripts"))
from vet import probe   # noqa: E402  (generic ffmpeg/ffprobe feature probe — reused, not forked, G4)

_MAX_TRAIL_SILENCE_S = 0.6
_MAX_HEADTAIL_DELTA_DB = 6.0


def _rms_of_segment(path, start, dur):
    st = subprocess.run(["ffmpeg", "-hide_banner", "-ss", str(start), "-t", str(dur), "-i", str(path),
                         "-af", "astats=metadata=1:reset=0", "-f", "null", "-"],
                        capture_output=True, text=True).stderr
    vals = [float(x) for x in re.findall(r"RMS level dB:\s*(-?\d+\.?\d*)", st)]
    return max(vals) if vals else -99.0


def loop_features(path, win_s=1.0) -> dict:
    """Head/tail RMS (continuity for looping) + trailing silence (a fade-out won't loop)."""
    base = probe(path)
    dur = base["duration"]
    head = _rms_of_segment(path, 0.0, win_s)
    tail = _rms_of_segment(path, max(0.0, dur - win_s), win_s)
    sil = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path),
                          "-af", "silencedetect=noise=-40dB:d=0.1", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start:\s*(-?\d+\.?\d*)", sil)]
    ends = [float(x) for x in re.findall(r"silence_end:\s*(-?\d+\.?\d*)", sil)]
    trail = 0.0
    if starts and (not ends or starts[-1] > ends[-1]) and (dur - starts[-1]) > 0:
        trail = round(dur - starts[-1], 3)
    return {"head_rms_db": round(head, 2), "tail_rms_db": round(tail, 2), "trail_silence_s": trail}


def vet_music(base: dict, loop: dict, dur_lo: float, dur_hi: float) -> dict:
    reasons = []
    d, peak, rms = base["duration"], base["peak_db"], base["rms_db"]
    head, tail, trail = loop["head_rms_db"], loop["tail_rms_db"], loop["trail_silence_s"]
    if not (dur_lo <= d <= dur_hi):
        reasons.append(f"duration {d:.1f}s out of [{dur_lo},{dur_hi}]")
    if peak >= 0.0:
        reasons.append(f"clip risk (peak {peak:.1f}dB)")
    if rms < -45:
        reasons.append(f"near-silent (rms {rms:.1f}dB)")
    if trail > _MAX_TRAIL_SILENCE_S:
        reasons.append(f"not loopable: fades to silence (trail {trail:.2f}s)")
    delta = abs(head - tail)
    if delta > _MAX_HEADTAIL_DELTA_DB:
        reasons.append(f"not loopable: head/tail level jump ({delta:.1f}dB)")
    loud = max(0.0, min(1.0, (rms + 45) / 45))
    cont = max(0.0, 1.0 - delta / _MAX_HEADTAIL_DELTA_DB)
    quality = round(0.5 * loud + 0.5 * cont, 3) if not reasons else 0.0
    return {"ok": not reasons, "reasons": reasons, "quality": quality}
```

- [ ] **Step 4: Run → PASS.**
Run: `py -3 .claude/skills/music-forge/scripts/test_music_vet.py`  → `running` / `PASS`

- [ ] **Step 5: Commit**
```bash
git add .claude/skills/music-forge/scripts/music_vet.py .claude/skills/music-forge/scripts/test_music_vet.py
git commit -m "feat(music-forge): music_vet.py — loop-ability + music vetting (reuses sfx probe)"
```

---

## Task 3: `fetch_incompetech.py` — populate `incoming/<bucket>/` (TDD + live verify)

**Files:** Create `.claude/skills/music-forge/scripts/fetch_incompetech.py`, `.../test_fetch_incompetech.py`

**Interfaces:**
- Produces: `track_url(name, template) -> str` (URL-encode a track name into the mp3 URL — PURE) · `fetch_bucket(bucket, cfg, out_dir, download=<fn>) -> {"saved":[names], "failed":[names], "sources": {file: meta}}` (download each seed, write `sources.json`; `download` injectable for tests) · a `main(channel)` CLI that fetches every bucket into `channels/<ch>/visual-kit/audio/incoming/<bucket>/`.

- [ ] **Step 1: Write the failing test** `test_fetch_incompetech.py` (no network — inject the downloader):
```python
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from fetch_incompetech import track_url, fetch_bucket

TMPL = "https://incompetech.com/music/royalty-free/mp3-royaltyfree/{name}.mp3"

def test_track_url_encodes_spaces():
    assert track_url("Sneaky Snitch", TMPL) == \
        "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Sneaky%20Snitch.mp3"

def test_fetch_bucket_saves_and_records(tmpdir=None):
    import tempfile
    out = Path(tempfile.mkdtemp())
    cfg = {"incompetech_seeds": ["Good Track", "Missing Track"]}
    def fake_dl(url, dest):
        if "Missing" in url:
            return False
        dest.write_bytes(b"ID3fake-mp3-bytes"); return True
    res = fetch_bucket("sneaky", cfg, out, download=fake_dl)
    assert res["saved"] == ["Good Track"] and res["failed"] == ["Missing Track"], res
    assert (out / "Good Track.mp3").exists()
    src = json.loads((out / "sources.json").read_text(encoding="utf-8"))
    assert src["Good Track.mp3"]["license"] == "CC-BY"
    assert src["Good Track.mp3"]["artist"] == "Kevin MacLeod (incompetech.com)"

print("running")
test_track_url_encodes_spaces(); test_fetch_bucket_saves_and_records()
print("PASS")
```

- [ ] **Step 2: Run → FAIL** (`ModuleNotFoundError`).
Run: `py -3 .claude/skills/music-forge/scripts/test_fetch_incompetech.py`

- [ ] **Step 3: Implement `fetch_incompetech.py`:**
```python
#!/usr/bin/env python3
"""Fetch casual-comedic seed tracks from Incompetech (Kevin MacLeod, CC-BY) into audio/incoming/<bucket>/.
Direct mp3 URL pattern verified 2026-07-11. Idempotent; a 404/failed download is skipped + reported (G8).
Writes sources.json per bucket (provenance for the CC-BY credit line). Seeds are DATA (music-buckets.json)."""
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

BUCKETS = Path(__file__).parent.parent / "music-buckets.json"
ROOT = Path(__file__).resolve().parents[4]
_ARTIST = "Kevin MacLeod (incompetech.com)"


def track_url(name, template):
    return template.format(name=urllib.parse.quote(name))


def _download(url, dest, attempts=3):
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "music-forge/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            if len(data) < 10000:      # a 404 HTML body, not an mp3
                return False
            dest.write_bytes(data); return True
        except Exception:
            if i == attempts - 1:
                return False
    return False


def fetch_bucket(bucket, cfg, out_dir, download=_download, template=None):
    template = template or "https://incompetech.com/music/royalty-free/mp3-royaltyfree/{name}.mp3"
    out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    saved, failed, sources = [], [], {}
    src_path = out_dir / "sources.json"
    if src_path.exists():
        sources = json.loads(src_path.read_text(encoding="utf-8"))
    for name in cfg.get("incompetech_seeds", []):
        dest = out_dir / f"{name}.mp3"
        ok = dest.exists() or download(track_url(name, template), dest)
        if ok:
            saved.append(name)
            sources[f"{name}.mp3"] = {"title": name, "artist": _ARTIST, "license": "CC-BY",
                                      "url": f"https://incompetech.com/music/royalty-free/index.html"}
        else:
            failed.append(name)
    src_path.write_text(json.dumps(sources, indent=2) + "\n", encoding="utf-8")
    return {"saved": saved, "failed": failed, "sources": sources}


def main(channel):
    cfg_all = json.loads(BUCKETS.read_text(encoding="utf-8"))
    tmpl = cfg_all["defaults"]["incompetech_url"]
    base = ROOT / "channels" / channel / "visual-kit" / "audio" / "incoming"
    for bucket, cfg in cfg_all["buckets"].items():
        res = fetch_bucket(bucket, cfg, base / bucket, template=tmpl)
        print(f"  {bucket}: saved {len(res['saved'])}, failed {res['failed']}")


if __name__ == "__main__":
    main(sys.argv[1])
```

- [ ] **Step 4: Run → PASS.**
Run: `py -3 .claude/skills/music-forge/scripts/test_fetch_incompetech.py`  → `running` / `PASS`

- [ ] **Step 5: LIVE verify (one bucket, real network)** — confirm the pattern still resolves end-to-end and drops real mp3s:
Run: `py -3 -c "import sys; sys.path.insert(0,'.claude/skills/music-forge/scripts'); from fetch_incompetech import fetch_bucket; import json; cfg={'incompetech_seeds':['Sneaky Snitch','Scheming Weasel faster']}; print(fetch_bucket('sneaky',cfg,'channels/the-second-take/visual-kit/audio/incoming/sneaky'))"`
Expected: `{'saved': ['Sneaky Snitch', 'Scheming Weasel faster'], 'failed': [], ...}` and the two mp3s exist under `incoming/sneaky/`. (If a seed 404s — a renamed track — note it; the human can adjust seeds. mp3s are gitignored.)

- [ ] **Step 6: Commit** (code only — downloaded mp3s are gitignored):
```bash
git add .claude/skills/music-forge/scripts/fetch_incompetech.py .claude/skills/music-forge/scripts/test_fetch_incompetech.py
git commit -m "feat(music-forge): fetch_incompetech.py — CC-BY seed downloader -> incoming/ (verified live)"
```

---

## Task 4: `music_forge.py` — `board` (vet + CLAP-rank `incoming/` → audition)

**Files:** Create `.claude/skills/music-forge/scripts/music_forge.py`, `.../test_music_forge.py`

**Interfaces:**
- Consumes: `vet.probe` + `rank.load_clap/clap_scores/rank` (sfx-forge, G4); `music_vet.loop_features/vet_music`; `music-buckets.json`; the files in `audio/incoming/<bucket>/`.
- Produces: `collect_files(bucket_cfg, feats_by_path) -> list[cand]` where `cand = {"path","name","quality"}` (PURE seam) · `run_board(channel, buckets, use_clap)` (writes `_audition/music/audition.html` + `candidates.json`) · CLI `board <channel> [--buckets a,b] [--no-clap]`.

- [ ] **Step 1: Write the failing test** `test_music_forge.py` (pure `collect_files`; feats injected):
```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from music_forge import collect_files

CFG = {"dur_s": [20, 220]}
def _f(dur=90.0, peak=-1.5, rms=-18.0, trail=0.1, head=-18.0, tail=-19.0):
    return ({"duration": dur, "peak_db": peak, "rms_db": rms, "lead_silence_s": 0.1},
            {"head_rms_db": head, "tail_rms_db": tail, "trail_silence_s": trail})

def test_collect_keeps_clean_loopable():
    feats = {"/x/Good.mp3": _f()}
    out = collect_files(CFG, feats)
    assert [c["name"] for c in out] == ["Good"] and "quality" in out[0], out

def test_collect_drops_nonloopable():
    feats = {"/x/Fades.mp3": _f(trail=2.0)}
    assert collect_files(CFG, feats) == []

def test_collect_drops_out_of_band_duration():
    feats = {"/x/Tiny.mp3": _f(dur=5.0)}
    assert collect_files(CFG, feats) == []

print("running")
test_collect_keeps_clean_loopable(); test_collect_drops_nonloopable(); test_collect_drops_out_of_band_duration()
print("PASS")
```

- [ ] **Step 2: Run → FAIL** (`ModuleNotFoundError`).
Run: `py -3 .claude/skills/music-forge/scripts/test_music_forge.py`

- [ ] **Step 3: Implement `music_forge.py`** (the `board` half + pure `collect_files`; `pick` added in Task 5):
```python
#!/usr/bin/env python3
"""music-forge orchestrator. SOURCE-AGNOSTIC: `board` vets + CLAP-ranks every candidate in
audio/incoming/<bucket>/ and emits an AUDITION artifact (the human checkpoint — G2/G6); `pick`
loudness-normalizes the chosen into audio/beds + wires music_pools. Populate incoming/ via
fetch_incompetech (CC-BY) or manual YT-Audio-Library drops. Reuses sfx-forge vet/rank (G4)."""
import argparse
import base64
import html
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sfx-forge" / "scripts"))
import rank as rankmod          # noqa: E402  (reused, G4)
from vet import probe           # noqa: E402
import music_vet                # noqa: E402

ROOT = Path(__file__).resolve().parents[4]
BUCKETS = Path(__file__).parent.parent / "music-buckets.json"
_AUDIO_EXT = (".mp3", ".wav", ".ogg", ".flac")


def collect_files(bucket_cfg, feats_by_path):
    """PURE: vet each candidate whose (base, loop) features are present; attach quality + name."""
    lo, hi = bucket_cfg["dur_s"]
    out = []
    for path, f in feats_by_path.items():
        base, loop = f
        v = music_vet.vet_music(base, loop, lo, hi)
        if v["ok"]:
            out.append({"path": str(path), "name": Path(path).stem, "quality": v["quality"]})
    return out


_CSS = """<style>
:root{--bg:#f4f5f7;--panel:#fffefc;--ink:#1c1e24;--muted:#6b6f77;--line:#e2e3e7;--accent:#3a6ea5;--accent-ink:#274b73;--ok:#2f8f6b;}
@media (prefers-color-scheme:dark){:root{--bg:#15171c;--panel:#1e2128;--ink:#ecebe8;--muted:#9a9ea7;--line:#2c2f38;--accent:#6fa8dc;--accent-ink:#6fa8dc;--ok:#57c79c;}}
:root[data-theme="light"]{--bg:#f4f5f7;--panel:#fffefc;--ink:#1c1e24;--muted:#6b6f77;--line:#e2e3e7;--accent:#3a6ea5;--accent-ink:#274b73;--ok:#2f8f6b;}
:root[data-theme="dark"]{--bg:#15171c;--panel:#1e2128;--ink:#ecebe8;--muted:#9a9ea7;--line:#2c2f38;--accent:#6fa8dc;--accent-ink:#6fa8dc;--ok:#57c79c;}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}
.wrap{max-width:1100px;margin:0 auto;padding:32px 24px 64px;color:var(--ink);font-family:system-ui,Segoe UI,sans-serif;line-height:1.5}
h1{font-size:30px;margin:0}.lead{font-size:15px;color:var(--muted);max-width:64ch;margin:.4rem 0 2.2rem}
.bucket{margin:0 0 2.4rem;border-top:1px solid var(--line);padding-top:1.1rem}
.bucket-h{display:flex;align-items:baseline;gap:.7rem;flex-wrap:wrap}
.bucket-h b{font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:var(--accent-ink)}
.bucket-h span{font-size:13px;color:var(--muted)}.pill{font-size:11px;border-radius:99px;padding:2px 9px;font-weight:600;margin-left:auto;color:var(--accent-ink);background:color-mix(in srgb,var(--accent) 16%,transparent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-top:.9rem}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:13px 14px;display:flex;flex-direction:column;gap:9px}
.card.top{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.nm{font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-ink);border:1px solid var(--accent);border-radius:99px;padding:1px 7px;align-self:flex-start}
audio{width:100%;height:34px}
.meta{display:flex;gap:12px;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,monospace}
.meta b{color:var(--ink)}.foot{font-size:12px;color:var(--ok);font-weight:600}
</style>"""


def _data_uri(p):
    return "data:audio/mp3;base64," + base64.b64encode(Path(p).read_bytes()).decode()


def _card(c, top=False):
    clap = "—" if c.get("clap") is None else f"{c['clap']:.2f}"
    badge = "<span class='badge'>CLAP top</span>" if top else ""
    return (f"<div class='card {'top' if top else ''}'>{badge}"
            f"<div class='nm' title='{html.escape(c['name'])}'>{html.escape(c['name'])}</div>"
            f"<audio controls preload='none' src='{c['data_uri']}'></audio>"
            f"<div class='meta'><span>clap <b>{clap}</b></span><span>vet <b>{c.get('quality',0):.2f}</b></span>"
            f"<span><b>{c.get('duration',0):.0f}</b>s</span></div>"
            f"<div class='foot'>CC-BY</div></div>")


def build_board(run, buckets_cfg):
    parts = ["<title>Music audition</title>", _CSS, "<div class='wrap'>", "<h1>Music library audition</h1>",
             "<p class='lead'>One section per mood bucket; each says how many to pick. Audition by ear "
             "(these loop under narration). Reply with the track name(s) per bucket.</p>"]
    for bucket, cands in run.items():
        cfg = buckets_cfg.get(bucket, {})
        tag = f"<span class='pill'>pick {cfg.get('pick_n')}</span>" if cfg.get("pick_n") else ""
        parts.append(f"<section class='bucket'><div class='bucket-h'><b>{html.escape(bucket)}</b>"
                     f"<span>{html.escape(cfg.get('mood_use',''))}</span>{tag}</div><div class='grid'>")
        parts += [_card(c, top=(i == 0)) for i, c in enumerate(cands)]
        parts.append("</div></section>")
    parts.append("</div>")
    return "".join(parts)


def run_board(channel, buckets, use_clap):
    cfg_all = json.loads(BUCKETS.read_text(encoding="utf-8"))
    ch = ROOT / "channels" / channel
    incoming = ch / "visual-kit" / "audio" / "incoming"
    out = ch / "visual-kit" / "audio" / "_audition" / "music"; out.mkdir(parents=True, exist_ok=True)
    want = buckets or list(cfg_all["buckets"].keys())
    clap = rankmod.load_clap() if use_clap else None
    print(f"CLAP: {'loaded' if clap else 'OFF (vet-only ranking)'}")
    run = {}
    for bucket in want:
        cfg = cfg_all["buckets"][bucket]
        files = [p for p in sorted((incoming / bucket).glob("*")) if p.suffix.lower() in _AUDIO_EXT]
        feats = {}
        for p in files:
            try:
                feats[p] = (probe(p), music_vet.loop_features(p))
            except Exception as e:
                print(f"    ! probe failed {p.name}: {type(e).__name__}")
        cands = collect_files(cfg, feats)
        durs = {str(p): probe_dur for p, (probe_dur, _) in ((p, feats[p]) for p in feats)}  # noqa
        for c in cands:
            c["duration"] = feats[Path(c["path"])][0]["duration"]
        if clap and cands:
            scores = rankmod.clap_scores(clap, [c["path"] for c in cands], cfg["clap_prompts"])
            for c, s in zip(cands, scores):
                c["clap"] = s
            ranked = rankmod.rank(cands, scorer=lambda c: c.get("clap"))
        else:
            ranked = rankmod.rank(cands, scorer=lambda c: None)
        top = ranked[: cfg_all["defaults"]["top_n"]]
        for c in top:
            c["data_uri"] = _data_uri(c["path"])
        run[bucket] = top
        print(f"  {bucket}: {len(files)} in incoming -> {len(cands)} vetted -> top {len(top)}")
    (out / "audition.html").write_text(build_board(run, cfg_all["buckets"]), encoding="utf-8")
    slim = {b: [{k: v for k, v in c.items() if k != "data_uri"} for c in cs] for b, cs in run.items()}
    (out / "candidates.json").write_text(json.dumps(slim, indent=2) + "\n", encoding="utf-8")
    print(f"AUDITION -> {out / 'audition.html'}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd")
    b = sub.add_parser("board"); b.add_argument("channel"); b.add_argument("--buckets", default="")
    b.add_argument("--no-clap", action="store_true")
    args = ap.parse_args()
    if args.cmd == "board":
        run_board(args.channel, [x for x in args.buckets.split(",") if x], not args.no_clap)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
```
*(Note: the `durs = {...}` line is dead scaffolding — delete it; each `c["duration"]` is set directly on the next lines. Keep only the `for c in cands: c["duration"] = …` assignment.)*

- [ ] **Step 4: Run → PASS.**
Run: `py -3 .claude/skills/music-forge/scripts/test_music_forge.py`  → `running` / `PASS`

- [ ] **Step 5: Commit**
```bash
git add .claude/skills/music-forge/scripts/music_forge.py .claude/skills/music-forge/scripts/test_music_forge.py
git commit -m "feat(music-forge): music_forge.py board — vet + CLAP-rank incoming/ -> audition"
```

---

## Task 5: `music_forge.py` — `pick` (loudnorm → beds → wire `music_pools`)

**Files:** Modify `.claude/skills/music-forge/scripts/music_forge.py`; extend `.../test_music_forge.py`

**Interfaces:**
- Produces: `assemble_pools(picks, sources) -> (pools, entries, attribs)` (PURE: `{bucket:[names]}` chosen-file names → `music_pools{bucket:[<bucket>-N]}` + manifest entries + CC-BY credit lines) · `_loudnorm(src, dst, lufs)` · `pick_music(channel, picks_path)` (loudnorm chosen `incoming/` files → `beds/<bucket>-N.mp3`, wire `music_pools`, manifest, attribution) · CLI `pick <channel> --picks <json>`.

- [ ] **Step 1: Add the failing test** (append to `test_music_forge.py`, before the run-line):
```python
from music_forge import assemble_pools

def test_assemble_pools_maps_and_credits():
    picks = {"sneaky": ["Sneaky Snitch.mp3", "Scheming Weasel faster.mp3"]}
    sources = {"sneaky": {
        "Sneaky Snitch.mp3": {"title": "Sneaky Snitch", "artist": "Kevin MacLeod (incompetech.com)",
                              "license": "CC-BY", "url": "https://incompetech.com/"},
        "Scheming Weasel faster.mp3": {"title": "Scheming Weasel", "artist": "Kevin MacLeod (incompetech.com)",
                                       "license": "CC-BY", "url": "https://incompetech.com/"}}}
    pools, entries, attribs = assemble_pools(picks, sources)
    assert pools == {"sneaky": ["sneaky-1", "sneaky-2"]}, pools
    assert entries["sneaky-1"]["source_file"] == "Sneaky Snitch.mp3"
    assert entries["sneaky-2"]["license"] == "CC-BY"
    assert any("sneaky-1" in a and "Kevin MacLeod" in a for a in attribs), attribs

print("running assemble"); test_assemble_pools_maps_and_credits(); print("PASS assemble")
```

- [ ] **Step 2: Run → FAIL** (`ImportError: cannot import name 'assemble_pools'`).
Run: `py -3 .claude/skills/music-forge/scripts/test_music_forge.py`

- [ ] **Step 3: Implement** — add to `music_forge.py`:
```python
def assemble_pools(picks, sources):
    """PURE: {bucket:[incoming_filename...]} + per-bucket sources meta -> (music_pools, manifest entries,
    CC-BY credit lines). Bed name = <bucket>-<n>. Every Incompetech track is CC-BY -> a credit line."""
    pools, entries, attribs = {}, {}, []
    for bucket, files in picks.items():
        names, smeta = [], sources.get(bucket, {})
        for n, fname in enumerate(files, 1):
            name = f"{bucket}-{n}"; m = smeta.get(fname, {})
            names.append(name)
            lic = (m.get("license") or "CC-BY").upper()
            entries[name] = {"file": f"beds/{name}.mp3", "bucket": bucket, "source_file": fname,
                             "title": m.get("title", Path(fname).stem), "artist": m.get("artist", ""),
                             "license": lic, "url": m.get("url", "")}
            if lic == "CC-BY":
                attribs.append(f"{name}: '{m.get('title', Path(fname).stem)}' by {m.get('artist','')} — "
                               f"{m.get('url','')} — Licensed under Creative Commons: By Attribution 4.0")
        if names:
            pools[bucket] = names
    return pools, entries, attribs


def _loudnorm(src, dst, target_lufs=-20.0):
    """One-pass EBU R128 loudnorm to a consistent integrated LUFS so every bed sits at the same perceived
    level (music is LOUDNESS-matched; the realizer's base_db does the ducking)."""
    subprocess.run(["ffmpeg", "-y", "-i", str(src),
                    "-af", f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11",
                    "-ar", "48000", "-ac", "2", "-c:a", "libmp3lame", "-q:a", "2", str(dst)],
                   capture_output=True, text=True)


def pick_music(channel, picks_path):
    ch = ROOT / "channels" / channel
    aud = ch / "visual-kit" / "audio"
    beds = aud / "beds"; beds.mkdir(parents=True, exist_ok=True)
    incoming = aud / "incoming"
    picks = json.loads(Path(picks_path).read_text(encoding="utf-8"))
    sources = {}
    for bucket in picks:
        sp = incoming / bucket / "sources.json"
        sources[bucket] = json.loads(sp.read_text(encoding="utf-8")) if sp.exists() else {}
    norm_lufs = json.loads(BUCKETS.read_text(encoding="utf-8"))["defaults"].get("norm_lufs", -20.0)
    pools, entries, attribs = assemble_pools(picks, sources)
    for name, e in entries.items():
        src = incoming / e["bucket"] / e["source_file"]
        if not src.exists():
            print(f"  ! {name}: {src.name} not in incoming/{e['bucket']} — skipped"); continue
        _loudnorm(src, beds / f"{name}.mp3", norm_lufs)
        print(f"  {name} <- {e['source_file']}")
    tokens_path = ch / "visual-kit" / "audio-tokens.json"
    tokens = json.loads(tokens_path.read_text(encoding="utf-8"))
    mp = tokens.setdefault("music_pools", {})
    for bucket, names in pools.items():
        mp[bucket] = names
    tokens_path.write_text(json.dumps(tokens, indent=2) + "\n", encoding="utf-8")
    man_path = aud / "manifest.json"
    man = json.loads(man_path.read_text(encoding="utf-8")) if man_path.exists() else {}
    man.setdefault("music", {}).update(entries)
    man_path.write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")
    if attribs:
        att = aud / "attribution.txt"
        prior = att.read_text(encoding="utf-8") if att.exists() else ""
        att.write_text(prior.rstrip() + "\n\n# Music (CC-BY) — paste into the video description\n"
                       + "\n".join(attribs) + "\n", encoding="utf-8")
    print(f"music_pools now: { {k: v for k, v in mp.items() if not k.startswith('_')} }")
```
Then extend `main()`:
```python
    p = sub.add_parser("pick"); p.add_argument("channel"); p.add_argument("--picks", required=True)
```
and dispatch:
```python
    elif args.cmd == "pick":
        pick_music(args.channel, args.picks)
```

- [ ] **Step 4: Run → PASS.**
Run: `py -3 .claude/skills/music-forge/scripts/test_music_forge.py`  → `PASS` … `PASS assemble`

- [ ] **Step 5: Commit**
```bash
git add .claude/skills/music-forge/scripts/music_forge.py .claude/skills/music-forge/scripts/test_music_forge.py
git commit -m "feat(music-forge): pick — loudnorm -> beds/ + wire music_pools/manifest/attribution"
```

---

## Task 6: `SKILL.md` + `music_pools` scaffold + registration

**Files:** Create `.claude/skills/music-forge/SKILL.md`; Modify `audio-tokens.json`, `.claude/skills/README.md`, `CLAUDE.md`

- [ ] **Step 1: Write `SKILL.md`** (frontmatter + prose sections):
  - **Frontmatter** — `name: music-forge`; a `description:` that triggers on "source/find/add music", "build the music library", "get a casual/comedic bed", "run the music audition", "the music sourcing step" for ANY channel with a `visual-kit/audio` setup; states: sources casual-comedic music (CC-BY, Incompetech / manual YT-Audio-Library drops) by mood bucket → objective vet (loop-ability/loudness/duration) → CLAP-rank → audition board → the HUMAN ear-gates the pick → wires `music_pools`. Explicitly NOT: authoring WHEN music plays (Phase-3B music-cue layer), AI-generating music, SFX (`sfx-forge`), or assembling the video (`render-builder`).
  - **When it runs** — a channel-setup / library-build step (like `sfx-forge`), a prerequisite for the Phase-3B lane.
  - **Inputs** — `music-buckets.json` (taxonomy + seeds + prompts; POINT to it, don't restate — G5); the `audio/incoming/<bucket>/` drop folder; the measured grammar (`universal.md §13a-iii.8` + `synthesis.md`) for target loudness/placement.
  - **The flow** — (1) `fetch_incompetech.py <channel>` populates `incoming/` (CC-BY) — and/or manually drop YT-Audio-Library "Comedy" tracks into `incoming/<bucket>/` + add a `sources.json` line. (2) `music_forge.py board <channel>` → `_audition/music/audition.html`. (3) human auditions by ear → replies with track name(s) per bucket. (4) `music_forge.py pick <channel> --picks picks.json` → loudnorm `beds/`, wire `music_pools`, CC-BY credits. (5) ear-gate again in the Phase-3B render (music judged in context, looping under VO).
  - **Casual-comedic, NOT cinematic** — the channel's music is the Crayon-Capital idiom (light quirky groove that rides under narration + goes dry on human cost), never a movie score. This is why the taxonomy is `casual-bed`/`upbeat`/`sneaky` + dry, and the source is Incompetech's comedic catalog, not cinematic stingers.
  - **Objective vet, human taste** (G6) — Claude runs the audition + CLAP ranking; the *feel* pick is the human's ([[audio-taste-is-human-judged]]). CLAP is stronger on full music clips than SFX transients but still a ranking aid, not a verdict.
  - **Scope boundaries** — NOT placement/music-cues (Phase-3B), AI-gen, SFX (`sfx-forge`), render (`render-builder`).
- [ ] **Step 2: Verify SKILL.md.**
Run: `py -3 -c "t=open('.claude/skills/music-forge/SKILL.md',encoding='utf-8').read(); assert t.startswith('---') and 'name: music-forge' in t; assert 'music-buckets.json' in t; print('SKILL ok', len(t))"`

- [ ] **Step 3: Add the `music_pools` scaffold** to `audio-tokens.json` — insert AFTER the `sfx_pools` block:
```json
  "music_norm_lufs": -20.0,
  "music_pools": {
    "_note": "Mood-bucket -> [bed file names] (audio/beds/<name>.mp3), sourced via music-forge (Incompetech CC-BY casual-comedic, loudness-normalized to music_norm_lufs). Buckets = the A1 taxonomy (music-forge/music-buckets.json): casual-bed/upbeat/sneaky. EMPTY until pick runs; the Phase-3B realizer treats an empty/absent pool as 'no music for that mood'. Provenance in audio/manifest.json['music']."
  },
```
Run: `py -3 -c "import json; d=json.load(open('channels/the-second-take/visual-kit/audio-tokens.json',encoding='utf-8')); assert 'music_pools' in d and 'music_norm_lufs' in d; print('tokens ok')"`

- [ ] **Step 4: Register** in `.claude/skills/README.md` (one roster entry: sources casual-comedic CC-BY music by mood bucket → vet → CLAP-rank → audition → human pick → wires `music_pools`; niche-agnostic) AND `CLAUDE.md` (bump "Skills built (N)" +1, add `music-forge`; audio bullet: **Phase-3A `music-forge` BUILT** — casual-comedic sourcing from Incompetech — integrate in place, no dated block).
Run: `grep -c "music-forge" CLAUDE.md .claude/skills/README.md`  (Expected: `≥1` each)

- [ ] **Step 5: Commit**
```bash
git add .claude/skills/music-forge/SKILL.md channels/the-second-take/visual-kit/audio-tokens.json .claude/skills/README.md CLAUDE.md
git commit -m "docs(music-forge): SKILL.md + music_pools scaffold + register (cross-file-consistent)"
```

---

## Task 7: A3 fetch + audition + pick (🔒 EAR-GATE) + A4 status log

**Files:** produces `audio/incoming/*` + `audio/beds/*.mp3` + `_audition/music/*` (mp3s gitignored; `manifest.json`/`attribution.txt`/`audio-tokens.json` tracked); Modify `knowledge/decisions.md`.

**Prerequisite:** Task 1's taxonomy CHECKPOINT approved.

- [ ] **Step 1: Confirm deps** (all present from `sfx-forge`):
Run: `py -3 -c "import torch, librosa; print('deps ok')"` and `ffmpeg -version | head -1`

- [ ] **Step 2: Fetch the seeds** (Incompetech, CC-BY; sequential):
Run: `py -3 .claude/skills/music-forge/scripts/fetch_incompetech.py the-second-take`
Expected: per-bucket `saved N, failed [...]`. For any failed seed (a renamed track), find the correct name on incompetech.com and update `music-buckets.json` seeds, or manually drop a YT-Audio-Library "Comedy" track into `incoming/<bucket>/` + add its `sources.json` line. **Optionally** browse the Incompetech "Feel: Humorous/Bouncy" list and add more seeds.

- [ ] **Step 3: Build the board** (CLAP; sequential — keep out of any fan-out):
Run: `py -3 .claude/skills/music-forge/scripts/music_forge.py board the-second-take`
Expected: per-bucket `in incoming -> vetted -> top` + `AUDITION -> …/_audition/music/audition.html`. Open it:
Run: `code channels/the-second-take/visual-kit/audio/_audition/music/audition.html`  ([[open-review-files-in-vscode]])

> **🔒 CHECKPOINT (human — the ear-gate, spec A3):** LISTEN to each bucket (tracks loop under narration). Pick the track name(s) per bucket (up to `pick_n`). If a bucket has no good option, drop different tracks into `incoming/<bucket>/` and re-board. This approves the **channel's music identity** — do NOT self-select ([[audio-taste-is-human-judged]]). Wait for the user's picks.

- [ ] **Step 4: Wire the picks.** Write the user's choices to `picks.json` (`{ "<bucket>": ["<track filename>.mp3", ...] }`), then:
Run: `py -3 .claude/skills/music-forge/scripts/music_forge.py pick the-second-take --picks picks.json`
Expected: `music_pools now: {…}` populated; `audio/beds/*.mp3` exist; `manifest.json['music']` + `attribution.txt` (CC-BY credits) updated.

- [ ] **Step 5: Log status (A4).** Append a dated `knowledge/decisions.md` entry (Phase-3A `music-forge` BUILT; casual-comedic taxonomy `casual-bed`/`upbeat`/`sneaky` + dry; source = Incompetech CC-BY, spike found Freesound the wrong catalog; which buckets got beds). Confirm the CLAUDE.md audio bullet reads "Phase-3A sourcing DONE → next = Phase-3B the lane (realizer + music-cue-writer), taxonomy locked." Integrate in place (G5).

- [ ] **Step 6: Commit** (tracked records only — bed/incoming mp3s gitignored):
```bash
git add channels/the-second-take/visual-kit/audio/manifest.json channels/the-second-take/visual-kit/audio/attribution.txt channels/the-second-take/visual-kit/audio-tokens.json knowledge/decisions.md CLAUDE.md
git commit -m "feat(music-forge): source the casual-comedic music library (taxonomy locked); resume -> Phase-3B lane"
```

---

## Self-Review (against the spec)

- **Spec coverage:** A1 casual-comedic taxonomy + checkpoint (Task 1) · A2 build music-forge w/ TDD (Tasks 2–5: `music_vet` loop-ability, `fetch_incompetech`, `board` vet/CLAP-rank, `pick` loudnorm/wire) · A3 fetch→audition→pick ear-gate (Task 7) · A4 wire `music_pools` + register + log (Tasks 6–7). Reuse of the sfx-forge stack (`vet`/`rank`/CLAP) explicit (G4). Guards G1–G9 each land on a task. **Source pivot to Incompetech CC-BY is captured** (spec's ideal list; Freesound spike disproved). B's unlock = Task 1's checkpoint.
- **Placeholder scan:** none — every code step ships complete code + tests; the one dead `durs = {...}` line in Task 4 is explicitly flagged for deletion; doc tasks specify exact section content + a mechanical verify; Task 7's only open variable is the human's picks (the intended ear-gate).
- **Type consistency:** `collect_files(bucket_cfg, feats_by_path)` where `feats_by_path[path]=(base,loop)` — matches the test + `run_board`. `vet_music(base, loop, dur_lo, dur_hi)` identical across `music_vet`, its test, `collect_files`. `loop_features` returns exactly the keys `vet_music` reads. `fetch_bucket(bucket, cfg, out_dir, download=..)` + `track_url(name, template)` match their tests. `assemble_pools(picks, sources) -> (pools, entries, attribs)` matches its test + `pick_music`; `entries[name]["source_file"]` is the `incoming/` filename `pick_music` loudnorms.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-11-phase3a-music-forge.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks.

**2. Inline Execution** — Execute tasks in this session with checkpoints.

**Which approach?**
