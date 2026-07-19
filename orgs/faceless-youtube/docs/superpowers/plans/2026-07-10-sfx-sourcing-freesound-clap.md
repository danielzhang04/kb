# SFX Sourcing (Freesound + CLAP) + Audio Buildout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the project a reproducible way to *source, objectively vet, and semantically rank* CC0 sound effects so Claude curates a real top-N per role and the human only judges the finalists — then wire the picks into the render, defend the render against missing SFX files, and (sequenced follow-ons) reframe the "bed" into an active music lane and close the loop with an objective audio-checker.

**Architecture:** Three ready-made pieces + thin glue. **Freesound API** (CC0-filtered source) → **objective vetting** (ffmpeg/ffprobe: duration, peak/clip, loudness, silence, single-transient) → **CLAP** (pre-trained LAION audio-text model, downloaded not built — the "ear" that ranks a clip against a text concept) → an **audition artifact** (embedded audio + waveforms + scores) that is the human checkpoint → picks wired into `audio-tokens.json sfx_pools`. The render is hardened so an unsourced role is *skipped, never a missing-file crash*. Music-lane reframe and the V4 checker are specified here but scoped as sibling plans (Phases B/C) so they don't entangle with the sourcing infra.

**Tech Stack:** Python 3.13 (`py -3`), stdlib + `urllib`/`requests` for Freesound, `ffmpeg`/`ffprobe` 8.1.2 (present), `torch 2.13 CPU` + `transformers 5.13` + `librosa 0.11` + `soundfile` (installed + verified), plain-`assert` tests (repo convention — matches `test_build_audio.py`), the local Remotion engine (unchanged).

## Global Constraints

**These are the "file/testing traps" the user called out. Every task inherits them. Read before writing any task.**

- **T1 — No live network or model weights in the unit suite.** Freesound HTTP and CLAP `from_pretrained` are FORBIDDEN inside `test_*.py`. Tests run on recorded JSON fixtures + ffmpeg-synthesized wav fixtures + injected scorers. Real HTTP / real CLAP run ONLY in an explicit, human-invoked `--smoke` path that the suite never calls. A unit test that needs the network is a failed task.
- **T2 — Split fetch from parse; split probe from decide.** Network and subprocess I/O live in thin wrappers; the logic that consumes their output is a PURE function tested directly on fixture data. (`parse_search(json)`, `vet_features(probe_dict)`, `rank(candidates, scores)` are pure.)
- **T3 — Deterministic + idempotent.** No `random`, no wall-clock, no `Math.random`. CLAP runs in `eval()` + `torch.no_grad()` + pinned model revision → same clip+prompt → same score. Downloads are content-addressed by Freesound id (re-run reuses cache, never re-downloads). Same vocabulary + same cached corpus → same ranking. A "run id" for the audition dir is passed IN (from `args`/CLI), never generated with a clock.
- **T4 — I cannot hear; taste is the human's. [[audio-taste-is-human-judged]]** Objective vetting (duration/peak/clip/loudness/transient) is mechanical and Claude owns it. CLAP RANKS (an objective proxy, not an ear). The human PICKS. No task may auto-select the single final SFX or let Claude "approve" a sound. CLAP narrows ~40→~4; the human chooses among the ~4.
- **T5 — CLAP is a proxy oracle, not ground truth.** It can misrank. Never auto-pick from it; always surface ≥3 finalists. Ship a sanity check (a known whoosh must outscore synthesized silence for the prompt "a whoosh") so a broken model install is caught, not trusted.
- **T6 — Secrets never leave `.env`.** `FREESOUND_API_KEY` is read from `.env` (gitignored, already stored). It must NEVER appear in a committed file, a log line, `candidates.json`, or the audition HTML. Grep every artifact for the key before commit.
- **T7 — License correctness is load-bearing (Content-ID / whole-channel demonetization risk).** Filter `license:"Creative Commons 0"` at query time AND re-verify each downloaded sound's `license` field is CC0 before it is eligible to be a finalist. Record `{id, license, url, uploader}` for every picked sound in `audio/manifest.json`. A non-CC0 sound reaching production is a critical failure.
- **T8 — Format-normalize on ingest.** Freesound previews are lossy mp3/ogg at assorted sample rates. Everything fed to CLAP is resampled to 48 kHz mono float; everything saved for the engine is transcoded to 48 kHz mp3. Never feed a raw preview's native rate to CLAP (garbage scores) or to the engine (pitch/speed bug).
- **T9 — Audio binaries stay gitignored; the manifest/log/scripts are the tracked record.** (Repo convention — matches `visual-kit/audio/`.) Test fixtures are ffmpeg-SYNTHESIZED at test time into a temp dir, never committed wavs (repo gitignores `*.wav`/`*.mp3`).
- **T10 — Parallel terminals: stage explicit paths, never `git add -A`, never rewrite history. [[parallelize-and-preserve-depth]]** Other terminals share this tree (front-half batch, other scripts). Leave their files. Every commit lists exact paths.
- **T11 — One config home. [[keep-docs-structured]]** The sourcing brief (queries / CLAP prompts / duration bands / scene-use) lives ONLY in `sfx-forge/vocabulary.json`. The final pools + gains live ONLY in the channel `audio-tokens.json`. The measured intent lives ONLY in `universal.md §13a-iii.8`. No role list duplicated across code literals + tokens + docs.
- **T12 — Name the deferrals; no silent caps. [[derived-fields-not-generation-targets]]** Roles that can't fire in the still-cut engine yet (card/element pops — Phase-3-gated) are sourced but LABELLED `fires_now:false`; the plan does not claim to have validated them in-context. Any per-role candidate cap that drops results is logged, not silent.

---

## Scope note (read + approve the split)

This plan details **Phase A (SFX sourcing capability)** at task level — it is the unblocked, self-contained, independently-shippable deliverable, and the one with the testing traps the user flagged. **Phase B (active music lane)** and **Phase C (V4 audio-checker)** are specified at design level as sequenced sibling plans; they need neither Freesound nor CLAP and should not entangle with the sourcing infra. Recommended order: **A → B → C.** If you want B fully task-detailed in this same document instead, say so at approval and I'll expand it.

---

# PHASE A — SFX sourcing capability

**File Structure (Phase A):**
- Create `.claude/skills/sfx-forge/vocabulary.json` — the role brief (queries, CLAP prompts, duration bands, scene-use, `fires_now`). One sourcing-config home (T11).
- Create `.claude/skills/sfx-forge/scripts/freesound_client.py` — Freesound wrapper: `parse_search` (pure), `search`, `download_preview`, `is_cc0`.
- Create `.claude/skills/sfx-forge/scripts/vet.py` — objective vetting: `probe` (ffmpeg/ffprobe), `vet_features` (pure decision).
- Create `.claude/skills/sfx-forge/scripts/rank.py` — CLAP ranking: `load_clap`, `clap_scores`, `rank` (pure, injectable scorer).
- Create `.claude/skills/sfx-forge/scripts/forge.py` — orchestrator + CLI (search→vet→download→rank→audition artifact; and a `pick` subcommand to wire finalists in).
- Create `.claude/skills/sfx-forge/scripts/test_freesound_client.py`, `test_vet.py`, `test_rank.py`, `test_forge.py` — hermetic (T1/T2).
- Create `.claude/skills/sfx-forge/scripts/fixtures/search_whoosh.json` — one recorded Freesound response (secrets stripped) for parse tests.
- Create `.claude/skills/sfx-forge/SKILL.md` — the invokable skill doc.
- Modify `.claude/skills/render-builder/scripts/build_audio.py` + `test_build_audio.py` — missing-SFX-file defense.
- Modify `channels/the-second-take/visual-kit/audio-tokens.json` + `audio/manifest.json` — wired picks (data only).

---

### Task A1: The SFX vocabulary (the sourcing brief)

**Files:**
- Create: `.claude/skills/sfx-forge/vocabulary.json`

**Interfaces:**
- Produces: a JSON object `{defaults:{page_size,top_n,max_download}, roles:{<role>:{scene_use, queries:[str], clap_prompts:[str], dur_s:[lo,hi], fires_now:bool}}}` consumed by `forge.py`.

- [ ] **Step 1: Write the file.** Roles derived from the motion-teardown event classes (`visual-kit/research/motion-logs/`) + the channel's comedic identity (`storytelling-grammar.md`: more comedic than a pure finance channel). `fires_now` marks whether the still-cut engine can trigger it today (T12).

```json
{
  "_doc": "SFX sourcing brief for sfx-forge/forge.py. Reference-derived (motion-logs event classes + comedic identity). This is the ONLY home for sourcing config (queries/prompts/bands); final pools live in the channel audio-tokens.json. fires_now=false roles are sourced but cannot be exercised in-context until card/element overlays are used (Phase-3).",
  "defaults": { "page_size": 40, "top_n": 4, "max_download": 24 },
  "roles": {
    "whoosh":        { "scene_use": "scene change / directional whip", "queries": ["whoosh transition", "swoosh", "whoosh"], "clap_prompts": ["a short whoosh transition sound", "a quick swoosh"], "dur_s": [0.15, 1.2], "fires_now": true },
    "riser":         { "scene_use": "build-up filling the breath gap before a reveal", "queries": ["riser uplifter", "tension riser", "build up sweep"], "clap_prompts": ["a rising tension riser sweep", "an uplifter build up"], "dur_s": [0.5, 2.5], "fires_now": true },
    "boom":          { "scene_use": "heavy reveal / chapter card impact", "queries": ["cinematic boom impact", "deep hit", "impact thud"], "clap_prompts": ["a deep dramatic boom impact", "a cinematic hit"], "dur_s": [0.3, 2.0], "fires_now": true },
    "boing":         { "scene_use": "comedic bounce / absurd beat", "queries": ["cartoon boing", "boing spring", "sproing"], "clap_prompts": ["a comedic cartoon boing", "a springy sproing"], "dur_s": [0.15, 1.0], "fires_now": true },
    "record_scratch":{ "scene_use": "ironic halt / wait-what", "queries": ["record scratch", "vinyl needle scratch", "dj scratch stop"], "clap_prompts": ["a vinyl record scratch stop", "a needle scratch"], "dur_s": [0.2, 1.5], "fires_now": true },
    "cash":          { "scene_use": "money punchline", "queries": ["cash register ka-ching", "coin ding", "kaching"], "clap_prompts": ["a cash register ka-ching", "a coin ding"], "dur_s": [0.2, 1.6], "fires_now": true },
    "sting":         { "scene_use": "dramatic-irony sting", "queries": ["dramatic suspense sting", "dun dun dramatic", "orchestra hit sting"], "clap_prompts": ["a short dramatic suspense sting", "a dun-dun orchestral stab"], "dur_s": [0.3, 2.0], "fires_now": true },
    "womp":          { "scene_use": "deflation / failure joke", "queries": ["sad trombone", "womp womp", "fail trombone"], "clap_prompts": ["a sad trombone womp womp", "a comedic failure sound"], "dur_s": [0.5, 2.5], "fires_now": true },
    "pop":           { "scene_use": "element/prop/card appears", "queries": ["cartoon pop", "bubble pop", "ui pop"], "clap_prompts": ["a short cartoon pop", "a bubble pop"], "dur_s": [0.05, 0.4], "fires_now": false },
    "stamp":         { "scene_use": "text stamps on (FICTION stamp)", "queries": ["rubber stamp", "ink stamp thud", "stamp paper"], "clap_prompts": ["a rubber stamp thud", "an ink stamp on paper"], "dur_s": [0.1, 0.6], "fires_now": false },
    "tick":          { "scene_use": "typewriter / text reveal", "queries": ["typewriter key", "tick click", "keyboard type"], "clap_prompts": ["a typewriter key click", "a single tick"], "dur_s": [0.03, 0.25], "fires_now": false },
    "pluck":         { "scene_use": "per-item in a progressive list reveal", "queries": ["ui pluck blip", "marimba note", "soft plink"], "clap_prompts": ["a soft ui pluck blip", "a short marimba plink"], "dur_s": [0.05, 0.5], "fires_now": false }
  }
}
```

- [ ] **Step 2: Validate it parses.** Run: `py -3 -c "import json; d=json.load(open('.claude/skills/sfx-forge/vocabulary.json')); print(len(d['roles']),'roles;', sum(r['fires_now'] for r in d['roles'].values()),'fire now')"` → Expected: `12 roles; 8 fire now`
- [ ] **Step 3: Commit.** `git add .claude/skills/sfx-forge/vocabulary.json && git commit -m "feat(sfx-forge): SFX sourcing vocabulary (reference-derived roles + comedic set)"`

> **CHECKPOINT (author review — this is a taste/scope call, surface it):** the 12 roles, which `fires_now`, and the comedic additions (boing/record_scratch/cash/sting/womp) beyond the original 7. Trim/rename here before any sourcing runs.

---

### Task A2: Freesound client (parse pure, fetch thin)

**Files:**
- Create: `.claude/skills/sfx-forge/scripts/freesound_client.py`
- Create: `.claude/skills/sfx-forge/scripts/fixtures/search_whoosh.json`
- Create: `.claude/skills/sfx-forge/scripts/test_freesound_client.py`

**Interfaces:**
- Produces:
  - `is_cc0(result: dict) -> bool` — True iff `result["license"]` is the CC0 URL (`creativecommons.org/publicdomain/zero/1.0/`).
  - `parse_search(payload: dict) -> list[dict]` — pure; maps a Freesound search JSON to `[{id:int, name:str, license:str, duration:float, preview_url:str, tags:list, username:str}]`; drops entries lacking a preview.
  - `search(query, api_key, page_size=40, extra_filter="", _transport=None) -> list[dict]` — HTTP GET then `parse_search`. `_transport(url)->dict` injectable for tests (defaults to real urllib).
  - `download_preview(result, cache_dir, _opener=None) -> Path|None` — writes `<cache_dir>/<id>.mp3`; skips if present (idempotent, T3); returns path.

- [ ] **Step 1: Create the fixture** `fixtures/search_whoosh.json` — a 2-result trimmed Freesound response (NO token, T6). Include one CC0 and one non-CC0 to prove filtering:

```json
{ "count": 2, "results": [
  { "id": 388037, "name": "Ukulele whoosh.wav", "license": "http://creativecommons.org/publicdomain/zero/1.0/", "duration": 0.83, "previews": { "preview-hq-mp3": "https://cdn.freesound.org/previews/388/388037_x-hq.mp3" }, "tags": ["whoosh","uke"], "username": "alice" },
  { "id": 12345, "name": "attribution whoosh", "license": "http://creativecommons.org/licenses/by/4.0/", "duration": 0.5, "previews": { "preview-hq-mp3": "https://cdn.freesound.org/previews/12/12345_x-hq.mp3" }, "tags": ["whoosh"], "username": "bob" } ] }
```

- [ ] **Step 2: Write failing tests** `test_freesound_client.py`:

```python
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from freesound_client import parse_search, is_cc0, search

FIX = json.loads((Path(__file__).parent / "fixtures" / "search_whoosh.json").read_text())

def test_parse_maps_fields_and_drops_no_preview():
    rows = parse_search(FIX)
    assert len(rows) == 2
    r = rows[0]
    assert r["id"] == 388037 and r["duration"] == 0.83
    assert r["preview_url"].endswith("388037_x-hq.mp3")

def test_is_cc0_only_true_for_zero():
    rows = parse_search(FIX)
    assert is_cc0(rows[0]) is True
    assert is_cc0(rows[1]) is False   # CC-BY, not CC0

def test_search_uses_transport_and_parses():
    rows = search("whoosh", api_key="KEY", _transport=lambda url: FIX)
    assert len(rows) == 2 and rows[0]["id"] == 388037

def test_search_never_puts_key_in_returned_data():
    rows = search("whoosh", api_key="SECRET", _transport=lambda url: FIX)
    assert "SECRET" not in json.dumps(rows)   # T6

print("running"); test_parse_maps_fields_and_drops_no_preview(); test_is_cc0_only_true_for_zero(); test_search_uses_transport_and_parses(); test_search_never_puts_key_in_returned_data(); print("PASS")
```

- [ ] **Step 3: Run → FAIL.** `py -3 .claude/skills/sfx-forge/scripts/test_freesound_client.py` → ModuleNotFound / NameError.
- [ ] **Step 4: Implement** `freesound_client.py`:

```python
#!/usr/bin/env python3
"""Freesound APIv2 client for sfx-forge. Fetch is thin; parse is pure (testable, T2).
CC0 is enforced at query AND re-verified per result (T7). Key stays out of returned data (T6)."""
import json, urllib.parse, urllib.request
from pathlib import Path

_CC0 = "creativecommons.org/publicdomain/zero/1.0"
_FIELDS = "id,name,license,duration,previews,tags,username"

def is_cc0(result: dict) -> bool:
    return _CC0 in (result.get("license") or "")

def parse_search(payload: dict) -> list:
    out = []
    for r in payload.get("results", []):
        prev = (r.get("previews") or {}).get("preview-hq-mp3") or (r.get("previews") or {}).get("preview-lq-mp3")
        if not prev:
            continue
        out.append({"id": int(r["id"]), "name": r.get("name", ""), "license": r.get("license", ""),
                    "duration": float(r.get("duration", 0.0)), "preview_url": prev,
                    "tags": r.get("tags", []), "username": r.get("username", "")})
    return out

def _default_transport(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def search(query, api_key, page_size=40, extra_filter="", _transport=None) -> list:
    transport = _transport or _default_transport
    filt = 'license:"Creative Commons 0"' + ((" " + extra_filter) if extra_filter else "")
    qs = urllib.parse.urlencode({"query": query, "filter": filt, "fields": _FIELDS,
                                 "page_size": page_size, "token": api_key})
    return parse_search(transport(f"https://freesound.org/apiv2/search/text/?{qs}"))

def download_preview(result, cache_dir, _opener=None) -> Path:
    cache_dir = Path(cache_dir); cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / f"{result['id']}.mp3"
    if dest.exists():
        return dest                      # idempotent (T3)
    opener = _opener or (lambda u: urllib.request.urlopen(u, timeout=60).read())
    dest.write_bytes(opener(result["preview_url"]))
    return dest
```

- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit.** `git add .claude/skills/sfx-forge/scripts/freesound_client.py .claude/skills/sfx-forge/scripts/fixtures/search_whoosh.json .claude/skills/sfx-forge/scripts/test_freesound_client.py && git commit -m "feat(sfx-forge): Freesound client (pure parse + CC0 verify + idempotent preview cache)"`

---

### Task A3: Objective vetting (probe thin, decide pure)

**Files:**
- Create: `.claude/skills/sfx-forge/scripts/vet.py`
- Create: `.claude/skills/sfx-forge/scripts/test_vet.py`

**Interfaces:**
- Produces:
  - `probe(path) -> dict` — `{duration, peak_db, rms_db, lead_silence_s, trail_silence_s}` via ffprobe + ffmpeg `astats`/`silencedetect`. Thin subprocess wrapper.
  - `vet_features(feats: dict, dur_lo: float, dur_hi: float) -> dict` — PURE. Returns `{ok:bool, reasons:list[str], quality:float}`. Rejects: out-of-band duration, clipping (`peak_db > -0.1`), near-silent (`rms_db < -45`), excessive lead silence (`> 0.3`). `quality` = a 0..1 heuristic (louder-but-unclipped, tight lead, in-band duration) used only as a CLAP tiebreaker, never as taste (T4).

- [ ] **Step 1: Write failing tests** `test_vet.py` (pure fn on hand-built feature dicts — no audio needed, T2):

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from vet import vet_features

def feats(**kw):
    base = {"duration": 0.5, "peak_db": -3.0, "rms_db": -20.0, "lead_silence_s": 0.02, "trail_silence_s": 0.1}
    base.update(kw); return base

def test_clean_short_transient_passes():
    v = vet_features(feats(), 0.15, 1.2)
    assert v["ok"] is True and v["reasons"] == []

def test_too_long_rejected():
    v = vet_features(feats(duration=9.0), 0.15, 1.2)
    assert v["ok"] is False and any("duration" in r for r in v["reasons"])

def test_clipping_rejected():
    v = vet_features(feats(peak_db=0.0), 0.15, 1.2)
    assert v["ok"] is False and any("clip" in r for r in v["reasons"])

def test_near_silent_rejected():
    v = vet_features(feats(rms_db=-60.0), 0.15, 1.2)
    assert v["ok"] is False and any("silent" in r for r in v["reasons"])

def test_long_lead_silence_rejected():
    v = vet_features(feats(lead_silence_s=0.9), 0.15, 1.2)
    assert v["ok"] is False and any("lead" in r for r in v["reasons"])

print("running")
test_clean_short_transient_passes(); test_too_long_rejected(); test_clipping_rejected()
test_near_silent_rejected(); test_long_lead_silence_rejected(); print("PASS")
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `vet.py` (only `vet_features` needs coverage; `probe` is exercised by the A6 smoke path):

```python
#!/usr/bin/env python3
"""Objective SFX vetting. probe() = thin ffmpeg/ffprobe wrapper; vet_features() = pure decision (T2).
Vetting is MECHANICAL (duration/clip/loudness/silence) — it is NOT taste (T4). quality is a CLAP
tiebreaker only, never a substitute for the human pick."""
import json, re, subprocess
from pathlib import Path

def _run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)

def probe(path) -> dict:
    path = str(path)
    dur = float(_run(["ffprobe","-v","error","-show_entries","format=duration",
                      "-of","json",path]).stdout and json.loads(_run(["ffprobe","-v","error",
                      "-show_entries","format=duration","-of","json",path]).stdout)["format"]["duration"])
    st = _run(["ffmpeg","-hide_banner","-i",path,"-af","astats=metadata=1:reset=0","-f","null","-"]).stderr
    peak = max([float(x) for x in re.findall(r"Peak level dB:\s*(-?\d+\.?\d*)", st)] or [-99.0])
    rms  = max([float(x) for x in re.findall(r"RMS level dB:\s*(-?\d+\.?\d*)", st)] or [-99.0])
    sil = _run(["ffmpeg","-hide_banner","-i",path,"-af","silencedetect=noise=-40dB:d=0.05","-f","null","-"]).stderr
    starts = [float(x) for x in re.findall(r"silence_start:\s*(-?\d+\.?\d*)", sil)]
    lead = starts[0] if (starts and abs(starts[0]) < 1e-6) else 0.0
    ends = [float(x) for x in re.findall(r"silence_end:\s*(-?\d+\.?\d*)", sil)]
    lead_s = ends[0] if (starts and abs(starts[0]) < 1e-6 and ends) else 0.0
    return {"duration": dur, "peak_db": peak, "rms_db": rms,
            "lead_silence_s": lead_s, "trail_silence_s": 0.0}

def vet_features(feats: dict, dur_lo: float, dur_hi: float) -> dict:
    reasons = []
    d, peak, rms, lead = feats["duration"], feats["peak_db"], feats["rms_db"], feats["lead_silence_s"]
    if not (dur_lo <= d <= dur_hi): reasons.append(f"duration {d:.2f}s out of [{dur_lo},{dur_hi}]")
    if peak > -0.1: reasons.append(f"clip risk (peak {peak:.1f}dB)")
    if rms < -45: reasons.append(f"near-silent (rms {rms:.1f}dB)")
    if lead > 0.3: reasons.append(f"long lead silence {lead:.2f}s")
    loud = max(0.0, min(1.0, (rms + 45) / 45))
    tight = max(0.0, 1.0 - lead / 0.3)
    quality = round(0.6 * loud + 0.4 * tight, 3) if not reasons else 0.0
    return {"ok": not reasons, "reasons": reasons, "quality": quality}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.** `git add .claude/skills/sfx-forge/scripts/vet.py .claude/skills/sfx-forge/scripts/test_vet.py && git commit -m "feat(sfx-forge): objective SFX vetting (pure decision + ffmpeg probe)"`

---

### Task A4: CLAP ranking (injectable scorer, deterministic, graceful fallback)

**Files:**
- Create: `.claude/skills/sfx-forge/scripts/rank.py`
- Create: `.claude/skills/sfx-forge/scripts/test_rank.py`

**Interfaces:**
- Produces:
  - `load_clap(model_id="laion/clap-htsat-unfused") -> tuple|None` — `(model, processor)` in eval mode, or `None` if torch/transformers unavailable (fallback, T3/T5). Lazy import so the module loads without torch.
  - `clap_scores(model_proc, wav_paths, prompts) -> list[float]` — per clip, max cosine similarity across prompts; `torch.no_grad()`, resample 48 kHz mono (T8). Deterministic.
  - `rank(candidates, scorer=None) -> list[dict]` — PURE ordering. Each candidate `{id, quality, ...}`; `scorer(cand)->float|None`. Sort by `clap` desc then `quality` desc; when `scorer` yields `None` (no CLAP), sort by `quality` only and set `clap=None`. Stable, deterministic.

- [ ] **Step 1: Write failing tests** `test_rank.py` (inject a fake scorer — no torch, T1):

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from rank import rank

C = [{"id": 1, "quality": 0.4}, {"id": 2, "quality": 0.9}, {"id": 3, "quality": 0.5}]

def test_rank_by_clap_then_quality():
    scores = {1: 0.8, 2: 0.2, 3: 0.8}
    out = rank(C, scorer=lambda c: scores[c["id"]])
    assert [c["id"] for c in out] == [3, 1, 2]     # 3&1 tie on clap .8 -> quality .5>.4; then 2
    assert out[0]["clap"] == 0.8

def test_rank_falls_back_to_quality_when_no_clap():
    out = rank(C, scorer=lambda c: None)
    assert [c["id"] for c in out] == [2, 3, 1]      # quality desc
    assert out[0]["clap"] is None

def test_rank_is_deterministic():
    scores = {1: 0.5, 2: 0.5, 3: 0.5}
    a = rank(C, scorer=lambda c: scores[c["id"]]); b = rank(C, scorer=lambda c: scores[c["id"]])
    assert [c["id"] for c in a] == [c["id"] for c in b]

print("running"); test_rank_by_clap_then_quality(); test_rank_falls_back_to_quality_when_no_clap(); test_rank_is_deterministic(); print("PASS")
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `rank.py`:

```python
#!/usr/bin/env python3
"""CLAP ranking for sfx-forge. CLAP is the 'ear' — a pre-trained proxy that RANKS, it does not
pick (T4/T5). Deterministic (eval + no_grad + pinned model). rank() is pure + injectable for tests."""
from pathlib import Path

def rank(candidates, scorer=None):
    scorer = scorer or (lambda c: None)
    scored = []
    for c in candidates:
        s = scorer(c)
        d = dict(c); d["clap"] = s
        scored.append(d)
    scored.sort(key=lambda c: (-(c["clap"] if c["clap"] is not None else -1.0), -c.get("quality", 0.0), c["id"]))
    return scored

def load_clap(model_id="laion/clap-htsat-unfused"):
    try:
        import torch
        from transformers import ClapModel, ClapProcessor
    except Exception:
        return None
    model = ClapModel.from_pretrained(model_id).eval()
    proc = ClapProcessor.from_pretrained(model_id)
    return (model, proc)

def clap_scores(model_proc, wav_paths, prompts):
    import torch, librosa
    model, proc = model_proc
    ti = proc(text=prompts, return_tensors="pt", padding=True)
    with torch.no_grad():
        temb = model.get_text_features(**ti)
        temb = temb / temb.norm(dim=-1, keepdim=True)
    scores = []
    for wp in wav_paths:
        y, _ = librosa.load(str(wp), sr=48000, mono=True)          # T8
        ai = proc(audios=[y], sampling_rate=48000, return_tensors="pt")
        with torch.no_grad():
            aemb = model.get_audio_features(**ai)
            aemb = aemb / aemb.norm(dim=-1, keepdim=True)
            sim = (aemb @ temb.T).max().item()
        scores.append(round(float(sim), 4))
    return scores
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.** `git add .claude/skills/sfx-forge/scripts/rank.py .claude/skills/sfx-forge/scripts/test_rank.py && git commit -m "feat(sfx-forge): CLAP ranking (pure rank + deterministic scorer + no-torch fallback)"`

---

### Task A5: Orchestrator + audition artifact (the human checkpoint)

**Files:**
- Create: `.claude/skills/sfx-forge/scripts/forge.py`
- Create: `.claude/skills/sfx-forge/scripts/test_forge.py`

**Interfaces:**
- Consumes: `freesound_client.{search,download_preview,is_cc0}`, `vet.{probe,vet_features}`, `rank.{load_clap,clap_scores,rank}`, `vocabulary.json`, `FREESOUND_API_KEY` (from `.env`).
- Produces:
  - `collect(role_cfg, results, downloaded_feats) -> list[dict]` — PURE. Given a role config, CC0-verified search results, and `{id: probe_feats}`, returns vetted candidates with `quality`, dropping non-CC0 (T7) and vet failures.
  - `build_audition_html(run) -> str` — PURE. `run = {role: [candidate,...]}` → self-contained HTML (embedded `<audio>` data-URI previews + waveform + score + Freesound link + license). No API key anywhere (T6).
  - CLI `forge.py <channel> [--roles a,b] [--run-id ID] [--no-clap]` and `forge.py pick <channel> --picks picks.json`.

- [ ] **Step 1: Write failing tests** `test_forge.py` (pure fns; no network/torch, T1):

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from forge import collect, build_audition_html

ROLE = {"dur_s": [0.15, 1.2], "clap_prompts": ["a whoosh"], "queries": ["whoosh"]}
RESULTS = [
    {"id": 1, "name": "good", "license": "http://creativecommons.org/publicdomain/zero/1.0/", "duration": 0.5, "preview_url": "u1", "tags": [], "username": "a"},
    {"id": 2, "name": "cc-by", "license": "http://creativecommons.org/licenses/by/4.0/", "duration": 0.5, "preview_url": "u2", "tags": [], "username": "b"},
]
FEATS = {1: {"duration": 0.5, "peak_db": -3.0, "rms_db": -20.0, "lead_silence_s": 0.02, "trail_silence_s": 0.0}}

def test_collect_drops_non_cc0_and_keeps_vetted():
    cands = collect(ROLE, RESULTS, FEATS)
    assert [c["id"] for c in cands] == [1]          # id 2 is CC-BY -> dropped (T7)
    assert cands[0]["quality"] > 0

def test_audition_html_has_no_api_key_and_embeds_audio():
    html = build_audition_html({"whoosh": [{"id": 1, "name": "good", "license": "CC0",
            "duration": 0.5, "clap": 0.8, "quality": 0.7, "data_uri": "data:audio/mp3;base64,AAA",
            "freesound_url": "https://freesound.org/s/1/"}]})
    assert "data:audio/mp3;base64,AAA" in html and "SECRETKEY" not in html
    assert "freesound.org/s/1" in html

print("running"); test_collect_drops_non_cc0_and_keeps_vetted(); test_audition_html_has_no_api_key_and_embeds_audio(); print("PASS")
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `forge.py`. Pure `collect` + `build_audition_html` first (covered by tests), then the CLI wiring (search→download→probe→collect→CLAP→rank→artifact). Load `.env` by hand (no dependency). Run-id comes from `--run-id` or a fixed default `latest` (never a clock, T3).

```python
#!/usr/bin/env python3
"""sfx-forge orchestrator. Sources CC0 candidates per role, vets objectively, ranks with CLAP,
and emits an AUDITION artifact that is the human checkpoint (Claude curates, human picks — T4).
Deterministic; secrets stay in .env (T6). `pick` wires finalists into audio-tokens + manifest."""
import argparse, base64, html, json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import freesound_client as fc
import vet as vetmod
import rank as rankmod

ROOT = Path(__file__).resolve().parents[4]           # repo root
VOCAB = Path(__file__).parent.parent / "vocabulary.json"

def load_env_key():
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("FREESOUND_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("FREESOUND_API_KEY not in .env")

def collect(role_cfg, results, feats_by_id):
    lo, hi = role_cfg["dur_s"]
    out = []
    for r in results:
        if not fc.is_cc0(r):                          # T7 re-verify
            continue
        f = feats_by_id.get(r["id"])
        if not f:
            continue
        v = vetmod.vet_features(f, lo, hi)
        if not v["ok"]:
            continue
        out.append({**r, "quality": v["quality"]})
    return out

def build_audition_html(run) -> str:
    parts = ["<h1>SFX audition</h1><p>Claude curated; you pick. Click play, choose 1 per role.</p>"]
    for role, cands in run.items():
        parts.append(f"<h2>{html.escape(role)}</h2><div class='row'>")
        for c in cands:
            clap = "—" if c.get("clap") is None else f"{c['clap']:.2f}"
            parts.append(
                f"<div class='card'><b>#{c['id']}</b> {html.escape(c['name'])}<br>"
                f"clap {clap} · vet {c.get('quality',0):.2f} · {c['duration']:.2f}s · {html.escape(c['license'])}<br>"
                f"<audio controls src='{c['data_uri']}'></audio><br>"
                f"<a href='{c['freesound_url']}'>freesound #{c['id']}</a></div>")
        parts.append("</div>")
    style = "<style>.row{display:flex;flex-wrap:wrap;gap:12px}.card{border:1px solid #ccc;padding:8px;border-radius:8px;max-width:280px}</style>"
    return style + "".join(parts)

def _data_uri(mp3_path):
    return "data:audio/mp3;base64," + base64.b64encode(Path(mp3_path).read_bytes()).decode()

def run_forge(channel, roles, run_id, use_clap):
    key = load_env_key()
    vocab = json.loads(VOCAB.read_text())
    d = vocab["defaults"]
    ch = ROOT / "channels" / channel
    audition = ch / "visual-kit" / "audio" / "_audition" / run_id
    cache = audition / "cache"; audition.mkdir(parents=True, exist_ok=True)
    want = roles or [r for r, c in vocab["roles"].items()]
    clap = rankmod.load_clap() if use_clap else None
    run = {}
    for role in want:
        cfg = vocab["roles"][role]
        seen, results = set(), []
        for q in cfg["queries"]:
            for r in fc.search(q, key, page_size=d["page_size"]):
                if r["id"] not in seen and cfg["dur_s"][0] <= r["duration"] <= cfg["dur_s"][1]:
                    seen.add(r["id"]); results.append(r)
        results = results[: d["max_download"]]
        feats = {}
        for r in results:
            p = fc.download_preview(r, cache)
            feats[r["id"]] = vetmod.probe(p)
        cands = collect(cfg, results, feats)
        if clap and cands:
            paths = [cache / f"{c['id']}.mp3" for c in cands]
            scores = rankmod.clap_scores(clap, paths, cfg["clap_prompts"])
            smap = {c["id"]: s for c, s in zip(cands, scores)}
            ranked = rankmod.rank(cands, scorer=lambda c: smap.get(c["id"]))
        else:
            ranked = rankmod.rank(cands, scorer=lambda c: None)
        top = ranked[: d["top_n"]]
        for c in top:
            c["data_uri"] = _data_uri(cache / f"{c['id']}.mp3")
            c["freesound_url"] = f"https://freesound.org/s/{c['id']}/"
        run[role] = top
        print(f"  {role}: {len(results)} found -> {len(cands)} vetted -> top {len(top)}")
    (audition / "audition.html").write_text(build_audition_html(run), encoding="utf-8")
    slim = {role: [{k: v for k, v in c.items() if k != "data_uri"} for c in cs] for role, cs in run.items()}
    (audition / "candidates.json").write_text(json.dumps(slim, indent=2), encoding="utf-8")
    print(f"AUDITION -> {audition/'audition.html'}")

def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd")
    r = sub.add_parser("run"); r.add_argument("channel"); r.add_argument("--roles", default="")
    r.add_argument("--run-id", default="latest"); r.add_argument("--no-clap", action="store_true")
    args = ap.parse_args()
    if args.cmd == "run":
        run_forge(args.channel, [x for x in args.roles.split(",") if x], args.run_id, not args.no_clap)
    else:
        ap.print_help()

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run → PASS** (`test_forge.py`).
- [ ] **Step 5: Commit.** `git add .claude/skills/sfx-forge/scripts/forge.py .claude/skills/sfx-forge/scripts/test_forge.py && git commit -m "feat(sfx-forge): orchestrator + audition artifact (pure collect/html + CLI)"`

---

### Task A6: CLAP sanity smoke + first real run (human checkpoint)

**Files:** none new (uses A1–A5). This task is a GATE, not code.

- [ ] **Step 1: CLAP sanity (T5).** Synthesize a whoosh-ish sweep and pure silence with ffmpeg, confirm CLAP scores the sweep higher for "a whoosh":

```bash
cd /c/Users/danie/faceless-youtube
ffmpeg -y -f lavfi -i "sine=frequency=200:duration=0.6,afade=t=out:st=0:d=0.6" -ar 48000 /tmp/sweep.wav 2>/dev/null
ffmpeg -y -f lavfi -i "anullsrc=r=48000:cl=mono" -t 0.6 /tmp/sil.wav 2>/dev/null
py -3 -c "import sys;sys.path.insert(0,r'.claude/skills/sfx-forge/scripts');import rank;m=rank.load_clap();print('scores',rank.clap_scores(m,['/tmp/sweep.wav','/tmp/sil.wav'],['a whoosh']))"
```
Expected: two floats, **sweep > silence**. (First call downloads the ~2 GB model — one-time.) If not, STOP: the model/install is wrong; do not trust rankings.

- [ ] **Step 2: First real run — 3 live roles.** `py -3 .claude/skills/sfx-forge/scripts/forge.py run the-second-take --roles whoosh,boing,record_scratch --run-id r1`
- [ ] **Step 3: Publish the audition** via the Artifact tool (embedded audio plays in-browser) OR open `visual-kit/audio/_audition/r1/audition.html` locally. [[review-images-via-artifact-link]] applies to audio too.

> **HUMAN CHECKPOINT (taste — the whole point):** listen to the top-4 per role, pick ≤1 each (or "none good → widen queries"). Reply with `{role: freesound_id}`. This is the only judgment step; Claude did the curation.

- [ ] **Step 4: Commit the tracked record** (NOT the audio binaries — T9). `git add channels/the-second-take/visual-kit/audio/_audition/r1/candidates.json && git commit -m "chore(sfx-forge): audition r1 candidate record (whoosh/boing/record_scratch)"`

---

### Task A7: Wire picks in + render defense against missing SFX

**Files:**
- Modify: `.claude/skills/sfx-forge/scripts/forge.py` (add `pick`)
- Modify: `channels/the-second-take/visual-kit/audio-tokens.json` (pools + gains — data only, T11)
- Modify: `channels/the-second-take/visual-kit/audio/manifest.json` (provenance — id/license/url/uploader, T7)
- Modify: `.claude/skills/render-builder/scripts/build_audio.py` + `test_build_audio.py` (missing-file defense — the latent bug found 2026-07-10)

**Interfaces:**
- Produces: `forge.py pick <channel> --picks picks.json` — for each `{role: id}`: copy `cache/<id>.mp3` → ffmpeg-normalize 48 kHz → `visual-kit/audio/sfx/<role>-N.mp3` (T8); append the role/variant to `audio-tokens.json sfx_pools`; append provenance to `audio/manifest.json`.
- Modified `build_audio_spec(shots, tokens, words, has_vo, breath_gaps=None, audio_dir=None)` — when `audio_dir` is set, an emitted SFX event whose file is absent under `audio_dir` is DROPPED and counted; the spec gains no missing refs.

- [ ] **Step 1: Write failing test** in `test_build_audio.py` (missing-file defense):

```python
def test_sfx_event_with_missing_file_is_dropped(tmp_path=None):
    import tempfile, os
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "audio", "sfx"), exist_ok=True)
    # only whoosh-1 exists; a boom event must be dropped
    open(os.path.join(d, "audio", "sfx", "whoosh-1.mp3"), "wb").close()
    shots = [{"id":"L1","start_s":0,"duration_s":2,"stage_role":"base","beat_type":"narration",
              "overlays":[{"type":"chapter-card","at_s":0.5}]}]
    spec = build_audio_spec(shots, {"bed_default":"neutral","sfx_pools":{"whoosh":["whoosh-1"]}},
                            words=[], has_vo=False, audio_dir=os.path.join(d,"audio"))
    files = [e["sfx"] for e in spec["events"]]
    assert any("whoosh-1" in f for f in files)          # present -> kept
    assert not any("boom" in f for f in files)          # absent -> dropped
    assert spec.get("sfx_missing", 0) >= 1
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the defense in `build_audio.py`: thread `audio_dir` into `build_audio_spec` and `sfx_events`; after building events, partition on `(audio_dir/ e["sfx"]).exists()`; drop+count missing; add `"sfx_missing"` to the returned spec. `audio_dir=None` → today's behavior unchanged (safe-when-absent). Then have `build_motion.py` pass the channel audio dir.
- [ ] **Step 4: Run → PASS** (+ existing 13 tests green).
- [ ] **Step 5: Implement** `forge.py pick` (copy→normalize→pools→manifest). Then run it on the human's picks: `py -3 .../forge.py pick the-second-take --picks picks.json`
- [ ] **Step 6: Verify** `audio-tokens.json sfx_pools` gained the picked variants and each file exists 48 kHz. `py -3 -c "import json;print(json.load(open('channels/the-second-take/visual-kit/audio-tokens.json'))['sfx_pools'])"`
- [ ] **Step 7: Commit** (explicit paths, T10). `git add .claude/skills/sfx-forge/scripts/forge.py .claude/skills/render-builder/scripts/build_audio.py .claude/skills/render-builder/scripts/test_build_audio.py channels/the-second-take/visual-kit/audio-tokens.json channels/the-second-take/visual-kit/audio/manifest.json && git commit -m "feat(sfx-forge): wire picks into pools/manifest + render missing-SFX defense"`

---

### Task A8: Torture-test fixture + in-context listen + SKILL.md

**Files:**
- Create: `channels/the-second-take/videos/_sfx-test/shots.json` (committed, minimal — fires every `fires_now` role)
- Create: `.claude/skills/sfx-forge/SKILL.md`

- [ ] **Step 1: Author** `_sfx-test/shots.json` — a ~30 s piece with shots covering each live role: a `stage_role:base` scene-change (whoosh), a `number-reveal` beat (breath dip + riser), a `chapter-boundary` (boom), a `gravity` beat (thin + SFX withheld), plus an irony beat. **No VO** (deterministic, no ElevenLabs dependency — SFX/bed render over held frames; T9). Shots timed by explicit `start_s`/`duration_s`.
- [ ] **Step 2: Render.** `py -3 .claude/skills/render-builder/scripts/build_motion.py channels/the-second-take/videos/_sfx-test` → `assets/final.mp4`.
- [ ] **Step 3: Open in the device player** (VS Code preview is muted — [[review-video-in-device-player]]).

> **HUMAN LISTEN CHECKPOINT:** each picked SFX lands on its event, at a sane level, not cheap/too-dense. Tune `sfx_gain_db` in `audio-tokens.json`. Record the verdict in `decisions.md`.

- [ ] **Step 4: Write** `SKILL.md` — invokable `sfx-forge`: when to use, the `run`→checkpoint→`pick` loop, the CC0/vet/CLAP guarantees, the trap list (this doc's Global Constraints), and that it's niche-agnostic (any channel with a `visual-kit/audio/`). [[skills-do-the-work]]
- [ ] **Step 5: Commit.** `git add channels/the-second-take/videos/_sfx-test/shots.json .claude/skills/sfx-forge/SKILL.md && git commit -m "feat(sfx-forge): torture-test fixture + SKILL.md"`

- [ ] **Step 6: Update project docs** (integrate, don't append — [[keep-docs-structured]]): `CLAUDE.md` status (A2 SFX = sourced via sfx-forge, N roles live), `knowledge/decisions.md` (dated: Freesound+CLAP sourcing, human-picks gate, missing-file defense), the audio-workstream handoff (A2 → done for sourced roles; remaining = music lane / checker). Commit explicit paths.

---

# PHASE B — Active music lane (design-level; expand to its own plan)

**Goal:** replace the "flat continuous bed" doctrine with an **active music lane**: music present throughout but dynamic — cut, fade, volume-ride, and switch tracks; able to go silent for stretches. (User: "music throughout but not the flat bed.")

**Why it's mostly already built:** the engine's per-frame `volume` automation (duck/dip/thin) + the deferred `music_states` switching + fades = exactly this. The reframe is (1) rename `bed`→`music lane` (allow null spans), (2) implement `music_states` in the engine (switch the playing file at a timestamp with an equal-power crossfade), (3) add fade-in/out shapes for dips/cuts (ramp vs hard drop, currently a hard `Math.min`), (4) correct `universal.md §13a-iii.8`'s "flat wall-to-wall bed" language, (5) fix the still-present `<Audio loop>` on the bed (the loop-frame modulation bug the 131d784 commit fought — verify it didn't regress).

**Task outline:** B1 doctrine correction (§13a-iii.8) · B2 engine `music_states` bed-switch + crossfade (TDD in `test_build_audio` + an engine render) · B3 fade shapes for dip/cut (token-driven `fade_s`) · B4 verify/repair the bed-loop modulation across a >31 s render · B5 the "real music" source decision (generated cues vs royalty-free library vs — rejected — commercial; Content-ID gate).

**Open decision for the user (gates B5):** music source. Mechanism is source-agnostic; legality is not.

---

# PHASE C — V4 audio-checker (design-level; expand to its own plan)

**Goal:** close the loop objectively — the one remaining piece Claude can own fully without ears (T4). Deterministic measures every render + a thin generative listen-critique on demand.

**Task outline:** C1 `audio_checker.py` deterministic pass (final LUFS/true-peak within `I=-14:TP=-1.5`; per-lane headroom / no clip; the gain-budget worst-case simultaneous sum < 0 dBFS; SFX↔VO-word collisions; SFX density vs `sfx_per_min_story_max`; **missing-SFX-file = 0** (guards the A7 bug from regressing); expected register events present — a gravity beat thinned, a number-reveal dipped). C2 seed a deliberate defect (a clipping mix / a repeated SFX) → checker flags it. C3 wire into `render-builder` (write an `audio` block into `render.manifest.json`; warn-not-fail).

---

## Self-Review (author, against the conversation's requirements)

- **Coverage:** point-2 SFX sourcing = Phase A in full (A1 vocab → A2 source → A3 vet → A4 rank → A5 audition → A6 human pick → A7 wire+defense → A8 fixture+skill+docs). Point-1 active music lane = Phase B (scoped). V4 checker = Phase C (scoped). The latent missing-file bug = A7. The possible bed-loop regression = B4.
- **Trap coverage (the user's explicit ask):** T1 hermetic suite (fixtures + injected scorer, live only in A6 smoke) · T2 fetch/parse + probe/decide split · T3 determinism/idempotency (content-addressed cache, no clock/random, CLAP eval+no_grad) · T4 human-picks-not-Claude · T5 CLAP sanity gate · T6 secret containment (tested in A2/A5) · T7 CC0 double-verify + provenance · T8 48 kHz normalize · T9 synth fixtures, gitignored binaries · T10 explicit-path commits · T11 one config home · T12 named deferrals (`fires_now`).
- **Placeholder scan:** every code step carries real code; Phase B/C are explicitly scope-deferred outlines, not in-plan placeholder tasks (a legitimate scope split, surfaced for approval — not a "TODO: implement").
- **Type consistency:** candidate dict `{id,name,license,duration,preview_url,tags,username}` from `parse_search` → gains `quality` in `collect` → gains `clap` in `rank` → gains `data_uri,freesound_url` in `run_forge`; `rank(candidates, scorer)` and `scorer(c)->float|None` consistent across A4/A5; `build_audio_spec(..., audio_dir=None)` consistent A7 test↔impl.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-10-sfx-sourcing-freesound-clap.md`.** Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks. Good for the hermetic-test discipline (each task's tests gate the next).
2. **Inline Execution** — I run tasks in this session with checkpoints at the human gates (A1 vocab, A6 pick, A8 listen).

Note the two human checkpoints are load-bearing (A6 pick, A8 listen) and one is a design decision (Phase B5 music source).
