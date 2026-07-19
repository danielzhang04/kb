# Reference Audio Analysis (Phase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Measure how reference channels use audio (pacing/breath, music behavior, loudness, transient density) across ~8 videos, and synthesize a **measured audio-grammar** that sets `audio-tokens.json` dials + informs the emission/music phases — with the reliable, deterministic measures load-bearing and the noisy ones (transient density, SFX identity) quarantined as directional.

**Architecture:** A deterministic **`analyze_audio.py`** battery (pure measurement functions + thin ffmpeg/librosa I/O wrappers) is the substance. A one-time **precompute** (`yt-dlp -x` audio + Demucs vocal/residual stems, cached) does the heavy lift sequentially so the per-video analysis runs fast. A **driver** runs the battery over all videos → per-video reports; a **synthesis** aggregates → the grammar. Deterministic tools produce the numbers; the LLM only structures/interprets them — never "listens."

**Tech Stack:** Python 3.13 (`py -3`), `demucs` (new install; torch present), `librosa`/`numpy`/`scipy` (present), `soundfile`, ffmpeg `ebur128` (present), `yt-dlp` (present), CLAP via the sfx-forge `rank.py` stack (present). Plain-`assert` tests (repo convention).

## Global Constraints

- **G1 — Deterministic tools produce data; the code/LLM only structures it.** No step "listens to" or "describes" audio. Every finding is a number from ffmpeg/librosa/Demucs. (The Gemini-hallucination fix.)
- **G2 — Audio-only, never video.** `yt-dlp -x`. No frames, no scene-detection, no vision. (Kills the size/timeout pitfall.)
- **G3 — Hermetic unit suite.** `test_*.py` run on **numpy-synthesized signals + captured tool-output fixtures** — NEVER Demucs, live `yt-dlp`, or CLAP. Real tools run only in an explicit `--smoke`/precompute path the suite never calls.
- **G4 — Pure measurement / thin I/O split.** Logic (parse, bucket, aggregate) is pure functions tested directly; ffmpeg/librosa/Demucs calls are thin wrappers exercised only in smoke.
- **G5 — Deterministic + idempotent.** No `random`, no wall-clock. Demucs stems + audio are content-addressed by video id and cached (re-run reuses, never re-downloads/re-separates). Same audio → same measures.
- **G6 — `[reliable]` vs `[directional]` is structural.** Every emitted metric carries a `confidence` field. Directional metrics (transient density, SFX-tag distribution) are physically segregated in the report and the grammar; nothing directional may set a load-bearing dial.
- **G7 — Beat maps are narrative (transcript-derived), never visual.** No cut detection.
- **G8 — Reproducible record; binaries gitignored.** `analyze_audio.py` + reports (JSON/md) + synthesis are tracked; audio/stem binaries are gitignored (repo convention). Reports carry the tool versions.
- **G9 — Parallel terminals.** Stage explicit paths, never `git add -A`, never rewrite history.

## File Structure

- Create `.claude/skills/audio-analyzer/scripts/measures.py` — pure measurement functions (parse/detect/bucket/aggregate). The tested core.
- Create `.claude/skills/audio-analyzer/scripts/io_tools.py` — thin wrappers: `ffprobe_dur`, `ebur128`, `librosa_onsets`, `stem_rms` (exercised in smoke only).
- Create `.claude/skills/audio-analyzer/scripts/beat_map.py` — narrative beat map from a transcript (pure).
- Create `.claude/skills/audio-analyzer/scripts/fetch_stems.py` — precompute: `yt-dlp -x` + Demucs → cached stems (the heavy, sequential, one-time step).
- Create `.claude/skills/audio-analyzer/scripts/analyze_audio.py` — per-video runner: cached stems + transcript + beat map → structured report; and a `--all` driver + `--synthesize` aggregator.
- Create `.claude/skills/audio-analyzer/scripts/test_measures.py`, `test_beat_map.py` — hermetic.
- Create `.claude/skills/audio-analyzer/videos.json` — the ~8-video set (ids/urls + which have a reused transcript).
- Output: `channels/the-second-take/visual-kit/research/audio-logs/<video>/report.json` + `synthesis.md`.
- Modify (at the synthesis gate): `knowledge/research/niche-playbooks/universal.md §13a-iii` + `channels/the-second-take/visual-kit/audio-tokens.json`.

---

## Task 1: Loudness measure (parse pure, ffmpeg thin)

**Files:** Create `measures.py`, `io_tools.py`, `test_measures.py`

**Interfaces:**
- Produces: `parse_ebur128(stderr: str) -> {"lufs": float, "lra": float, "true_peak": float}` (pure); `ebur128(path) -> dict` (thin: runs ffmpeg, calls parse).

- [ ] **Step 1: Capture a fixture.** Run once, by hand, to get a real ebur128 Summary block and paste it into the test as `EBUR` (a multi-line string with `I: -18.3 LUFS`, `LRA: 4.2 LU`, `Peak: -1.1 dBFS`).
- [ ] **Step 2: Write failing test** `test_measures.py`:
```python
import sys; from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from measures import parse_ebur128
EBUR = "[Parsed_ebur128_0 @ ...] Summary:\n  Integrated loudness:\n    I:         -18.3 LUFS\n  Loudness range:\n    LRA:         4.2 LU\n  True peak:\n    Peak:       -1.1 dBFS\n"
def test_parse_ebur128():
    r = parse_ebur128(EBUR)
    assert r["lufs"] == -18.3 and r["lra"] == 4.2 and r["true_peak"] == -1.1
print("running"); test_parse_ebur128(); print("PASS")
```
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** `parse_ebur128` in `measures.py` (regex `I:\s*(-?\d+\.?\d*)\s*LUFS`, `LRA:\s*(-?\d+\.?\d*)`, `Peak:\s*(-?\d+\.?\d*)\s*dBFS`) and the thin `ebur128(path)` in `io_tools.py` (`ffmpeg -i path -af ebur128 -f null -` → parse stderr).
- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** `git add .claude/skills/audio-analyzer/scripts/measures.py .claude/skills/audio-analyzer/scripts/io_tools.py .claude/skills/audio-analyzer/scripts/test_measures.py && git commit -m "feat(audio-analyzer): loudness measure (pure ebur128 parse + thin wrapper)"`

---

## Task 2: Speech regions + gap distribution (pure, from stem RMS)

**Files:** Modify `measures.py`, `test_measures.py`

**Interfaces:**
- Produces:
  - `speech_regions(rms: list[float], hop_s: float, thresh_db: float=-35, min_gap_s: float=0.25) -> list[[start,end]]` — pure; contiguous frames above `thresh_db` (relative to the track's own peak) merged into speech spans, gaps shorter than `min_gap_s` bridged.
  - `speech_gaps(regions: list) -> list[float]` — pure; the silence durations *between* speech spans.

- [ ] **Step 1: Write failing tests** (synthesized RMS frame array — hermetic, G3):
```python
from measures import speech_regions, speech_gaps
def test_speech_regions_and_gaps():
    # 0.1s hops: loud, loud, quiet, quiet, quiet, loud  -> two spans, one ~0.3s gap
    rms = [-5,-5,-60,-60,-60,-5]
    regs = speech_regions(rms, hop_s=0.1, thresh_db=-35, min_gap_s=0.05)
    assert regs == [[0.0,0.2],[0.5,0.6]], regs
    gaps = speech_gaps(regs)
    assert abs(gaps[0]-0.3) < 1e-6, gaps
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `speech_regions` (peak-relative dB threshold over the frame array → runs of above-threshold hops → spans; bridge sub-`min_gap_s` gaps) and `speech_gaps` (between-span silences). Pure over the list.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** (explicit paths).

---

## Task 3: Onset density + breath-around-events bucketed by acoustics (pure)

**Files:** Modify `measures.py`, `test_measures.py`

**Interfaces:**
- Produces:
  - `onset_density(onsets: list[float], duration_s: float) -> float` — pure; onsets per minute.
  - `breath_around_events(events: list[dict], regions: list) -> list[dict]` — pure; each `event={at_s,dur_s,loud_db,centroid_hz}` → adds `gap_before`/`gap_after` (silence adjacent to the event in the speech regions).
  - `bucket_by_acoustics(events_with_gaps: list) -> dict` — pure; buckets events into `sustained_loud` / `short_percussive` / `mid` by `dur_s`+`centroid_hz`, returns per-bucket median `gap_before`/`gap_after` + n. (Captures "dramatic sting → long pause; thud → no pause" WITHOUT SFX-ID — G6 directional? No: gap+acoustics are measured, so [reliable]; only the *label name* is interpretive.)

- [ ] **Step 1: Write failing tests** (synthesized events + regions):
```python
from measures import onset_density, breath_around_events, bucket_by_acoustics
def test_onset_density():
    assert abs(onset_density([1,2,3,4], 120.0) - 2.0) < 1e-6   # 4 onsets / 2 min
def test_breath_and_buckets():
    regions = [[0,2.0],[3.2,5.0]]                       # a 1.2s gap at 2.0..3.2
    events = [{"at_s":2.1,"dur_s":1.5,"loud_db":-6,"centroid_hz":300},   # sustained low -> in the gap
              {"at_s":4.0,"dur_s":0.1,"loud_db":-8,"centroid_hz":4000}]  # short bright -> mid-speech
    ev = breath_around_events(events, regions)
    assert ev[0]["gap_before"] >= 1.0 and ev[1]["gap_before"] == 0.0
    b = bucket_by_acoustics(ev)
    assert b["sustained_loud"]["n"] == 1 and b["short_percussive"]["n"] == 1
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the three functions (pure). `breath_around_events`: for each event, the gap it sits in (0 if mid-speech). `bucket_by_acoustics`: `dur_s>=0.8 and centroid<1500 -> sustained_loud`; `dur_s<0.3 -> short_percussive`; else `mid`; aggregate medians.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.**

---

## Task 4: Music presence + dips (pure, from residual vs vocal energy)

**Files:** Modify `measures.py`, `test_measures.py`

**Interfaces:**
- Produces:
  - `music_presence(residual_rms: list, floor_db: float=-45) -> float` — pure; fraction of frames with residual energy above floor.
  - `music_dips(residual_rms: list, hop_s: float, drop_db: float=10, min_s: float=0.3) -> list[[start,end,depth]]` — pure; spans where residual drops ≥`drop_db` below its local median for ≥`min_s` (music tacet / dropout).
  - `ducking_depth(residual_rms, regions) -> float` — pure; median residual level during speech minus during gaps (how much music ducks under VO).

- [ ] **Step 1: Write failing tests** (synthesized residual arrays with a known dip + a speech/gap split). *(full assert code — mirror Task 2/3 style, known arrays → known presence %, one detected dip, a positive ducking delta.)*
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** (pure). **Step 4: PASS.** **Step 5: Commit.**

---

## Task 5: Narrative beat map from transcript (pure)

**Files:** Create `beat_map.py`, `test_beat_map.py`

**Interfaces:**
- Produces: `narrative_beats(transcript: list[dict]) -> list[dict]` — pure; `transcript=[{t,text}]` → `[{at_s, kind}]` where `kind∈{act, reveal, punchline, plain}` inferred from transcript structure (long pause before a line → act/chapter boundary; a short line after a build → reveal/punchline candidate; via sentence length + inter-line gaps). Directional (labels are inferred) → each beat carries `confidence:"directional"`.

- [ ] **Step 1: Write failing test** on a small fixture transcript (a build-up of long lines then a short punchy line → that line tagged `reveal`/`punchline`; a big inter-line gap → `act`). Assert the tags land on the right timestamps.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** (pure heuristic over line lengths + gaps). **Step 4: PASS.** **Step 5: Commit.**

---

## Task 6: Precompute — audio + Demucs stems, cached (smoke, not unit)

**Files:** Create `fetch_stems.py`, `videos.json`

**Interfaces:** Produces `fetch_stems.py <video_id>` → `audio-logs/_stems/<id>/{vocal.wav, residual.wav}` (idempotent: skip if present). `videos.json` = the 8 entries (id, url, has_reused_transcript).

- [ ] **Step 1: Install Demucs.** `py -3 -m pip install demucs` → confirm `py -3 -c "import demucs; print('ok')"`.
- [ ] **Step 2: Author `videos.json`** — the 6 motion-teardown videos (ids from `motion-logs/`) + 2 OverSimplified picked via `yt-dlp` top-views (record which 2 in the file).
- [ ] **Step 3: Implement `fetch_stems.py`** — `yt-dlp -x --audio-format wav <url>` → `htdemucs` two-stem (`--two-stems=vocals`) → move `vocals.wav`→`vocal.wav`, `no_vocals.wav`→`residual.wav` into the cache; idempotent; content-addressed by id.
- [ ] **Step 4: SMOKE (human-run, not in suite):** run on ONE video → confirm both stems exist, non-empty, and the vocal stem's speech regions (Task 2) align with that video's transcript timestamps (±0.5s on a spot-checked line). If misaligned, STOP — the stem/transcript timebase is off.
- [ ] **Step 5: Commit** the scripts + `videos.json` (NOT the wav stems — gitignored, G8).

> **CHECKPOINT (author):** Demucs runtime per video is acceptable; stems look right on the one smoke video before fanning out to all 8.

---

## Task 7: Per-video runner + report

**Files:** Modify `analyze_audio.py`

**Interfaces:** `analyze_audio.py <video_id>` → reads cached stems + transcript + (narrative) beat map → runs the full battery (Tasks 1–5 via `io_tools` + `measures`) → writes `audio-logs/<id>/report.json` (every metric tagged `[reliable]`/`[directional]` + `confidence`, G6) + a human `report.md`. CLAP onset-tagging (directional) reuses `sfx-forge/scripts/rank.py`.

- [ ] **Step 1:** Implement the runner: load stems (`stem_rms` via `io_tools`), onsets on residual, ebur128 on the mixed audio, speech regions/gaps on the vocal stem, breath-around-events + buckets, music presence/dips/ducking, narrative beats; align dips/breath to beats. Assemble the tagged report.
- [ ] **Step 2:** Run on the one smoke video → eyeball `report.json`: reliable block (LUFS/gaps/presence/ducking) populated + sane; directional block (density/SFX-tags) clearly segregated.
- [ ] **Step 3: Commit** the runner + the one report (`report.json`/`.md` are tracked; stems are not).

---

## Task 8: Fan-out driver + synthesis + grammar integration

**Files:** Modify `analyze_audio.py` (add `--all`, `--synthesize`)

**Interfaces:** `--all` runs the runner over every `videos.json` entry (sequential or dispatched — each is light since stems are cached). `--synthesize` aggregates all `report.json` → `synthesis.md` (per-metric distributions/bands across the set; reliable vs directional kept separate; the Kurzgesagt "floor" flagged as the restrained contrast).

- [ ] **Step 1:** Precompute stems for all 8 (`fetch_stems.py` each — the sequential heavy step). Then `analyze_audio.py --all`.
- [ ] **Step 2:** Implement `--synthesize` → `synthesis.md`: the measured grammar — breath/gap distribution (+ the by-acoustic-bucket table), music presence % + dip depth/placement, ducking depth, LUFS/LRA band, transient-density band (labeled directional). Each number annotated with the dial it sets.

> **SYNTHESIS GATE (human):** review `synthesis.md` — is the grammar coherent + actionable, reliable/directional cleanly separated, each number mapped to a dial? [[audio-taste-is-human-judged]] applies to any feel-based reading.

- [ ] **Step 3:** On approval, integrate (integrate-don't-append, [[keep-docs-structured]]): write the measured laws into `universal.md §13a-iii` and the concrete numbers into `audio-tokens.json`; note in `decisions.md` + the audio handoff. Commit explicit paths.
- [ ] **Step 4:** Write `SKILL.md` for `audio-analyzer` (invokable: precompute → analyze → synthesize; the reliable/directional contract; audio-only/no-video; deterministic-tools guardrail).

---

## Self-Review (author, against the spec)

- **Spec coverage:** battery A (pacing/breath: Tasks 2,3) · B (music: Task 4) · C (loudness: Task 1) · D (density: Task 3) · E (SFX-tag: Task 7 directional) · precompute+cache (Task 6) · narrative beat map (Task 5) · fan-out+synthesis (Task 8) · grammar deliverable (Task 8). Downstream phases correctly out of this plan.
- **Guardrails:** G1 tools-not-listening (every measure is a tool number) · G2/G7 no video/no cuts · G3 hermetic (Tasks 1–5 tests use synthesized arrays + a captured string; Demucs/CLAP/yt-dlp only in Task 6/7 smoke) · G4 pure/thin split (measures.py vs io_tools.py) · G5 idempotent cache · G6 reliable/directional tagged in the report + synthesis · G8 binaries gitignored.
- **Placeholders:** Task 4 Step 1 and Task 5 Step 1 name the assertion shape rather than spelling every line — flagged; the implementer mirrors the fully-written Task 2/3 test style. No other gaps.
- **Type consistency:** `speech_regions -> [[start,end]]` consumed identically by `speech_gaps`, `breath_around_events`, `ducking_depth`; `event` dict `{at_s,dur_s,loud_db,centroid_hz}` consistent Task 3↔7; every report metric carries `confidence`.

## Execution Handoff

Plan complete → `docs/superpowers/plans/2026-07-10-audio-reference-analysis.md`. Two options:
1. **Subagent-driven (recommended)** — fresh subagent per task; the hermetic Tasks 1–5 are clean isolated TDD; Tasks 6–8 are the smoke/precompute/synthesis with human gates.
2. **Inline** — run here with checkpoints at the Task-6 stem smoke and the Task-8 synthesis gate.
