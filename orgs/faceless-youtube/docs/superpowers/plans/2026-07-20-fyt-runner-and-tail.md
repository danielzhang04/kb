# FYT Runner + Tail + Gate Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the post-render tail (compliance-check, thumbnail, shot board, publish-queue, analytics), fix the three structural gate defects from fyt-run-001, and land the `fyt-runner` agent + workflow segments that orchestrate the whole pipeline.

**Architecture:** Part 1 hardens the existing render gate (image-review DAG node, third `review_status` state, layered-shot verification). Parts 2–6 add the five tail components as org skills matching the existing skill layout (`SKILL.md` + `scripts/` + colocated `test_*.py`). Part 7 lands the gates-first `fyt-runner` agent and four committed workflow segment scripts. Part 8 is the poyais live test.

**Tech Stack:** Python 3 (`py -3`, stdlib + PIL/Pillow only — no new deps), Workflow-tool JavaScript for segments, Markdown agent/skill defs, youtube-uploader MCP for upload, YouTube Data/Analytics REST via stdlib `urllib` for analytics.

## Global Constraints

- Working tree: `C:\Users\danie\kb-worktrees\faceless-import`, branch `claude/faceless-live-import`. All paths below are relative to `orgs/faceless-youtube/` unless they start with `dashboard/`, `agents/`, or `docs/plans` (repo root).
- Spec of record: `docs/superpowers/specs/2026-07-20-fyt-runner-synthesis-design.md` (org-relative). Read it before any task.
- Run `python scripts/preamble.py` (repo root) once per session; STOP if it fails.
- Tests: colocated `test_*.py`, run as `py -3 <path>` (never bare `python` — the MSYS python lacks yaml). Network-free, fixture-based, no API keys read.
- Commits: explicit paths only (`git add <file> <file>` — never `git add -A`). Wells-fargo has UNCOMMITTED manifest edits that must never be swept into a commit. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Zero API spend in Tasks 1–14. The only potentially-paid call in this arc is poyais thumbnail generation (Task 15) and it requires the orchestrator's explicit go-ahead in-session.
- Never read, print, or copy `.env` values. Analytics code reads env var NAMES only (`YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`, `YOUTUBE_OAUTH_REFRESH_TOKEN`) at runtime.
- Single-writer rule: nothing in this plan writes `shots.json` / `shots.motion.json` / `audio-plan.json` for any video.
- YAGNI: build exactly what the spec says; no generic abstractions.

---

### Task 1: `image-review` node in `workflows/video-run.md` + drift corrections

**Files:**
- Modify: `workflows/video-run.md`

**Interfaces:**
- Produces: a stage `id: image-review` with `dependsOn: [images, motion]`, `riskTier: T2`, artifact description "assets/_review/ shard rulings + merged.json and an honestly-stamped assets/scenes/manifest.json"; `render.dependsOn` becomes `[metadata, shorts, motion, image-review, audio-plan]`. Task 4 (test update) and Task 14 (segments) rely on these exact ids.

- [ ] **Step 1: Read the current def.** Read `workflows/video-run.md` fully. Note the exact YAML stage-entry format (id/title/dependsOn/riskTier/artifact fields) — mirror it exactly.
- [ ] **Step 2: Add the node.** Insert after the `images` stage, matching the surrounding format:

```yaml
  - id: image-review
    title: Batched review of every generated still (the image gate)
    dependsOn: [images, motion]
    riskTier: T2
```

with a work-order body (prose section, matching how other stages document theirs) stating: opens every scene PNG and every layered shot's plate+cutouts (enumerated via the motion plan's `cutout_layer_ids`), letter-by-letter on lettering, silence disallowed; writes shard rulings + `merged.json` under `assets/_review/`; ends by stamping `assets/scenes/manifest.json` `review_status` per shot (`verified` or `parked` with reasons) via `image-generation/scripts/stamp_review.py`; the artifact is the stamped manifest and the DAG is NOT satisfied by PNGs existing. Cite the fyt-run-001 law: a stage never holds the gate that blocks its own work — this node is conductor-run, never the generating agent.
- [ ] **Step 3: Repoint render.** Change `render`'s `dependsOn` from `[metadata, shorts, motion, images, audio-plan]` to `[metadata, shorts, motion, image-review, audio-plan]`.
- [ ] **Step 4: Fold in the drift corrections** (from `agents/fyt-producer.md` "Known drift" table — the run's reality is authoritative): paths are `channels/<name>/videos/<slug>/`; judge-gate artifact is `judge-verdict.md`; shorts artifacts are `shorts/short-NN.md`; the images stage title/body must say it is a PAID Gemini stage (~$17/video, card-authorised); add a short "Single-writer staging" paragraph (stage agents write `staging/`, only the conductor merges to the video root and re-lints).
- [ ] **Step 5: Verify parseability.** The def must stay valid YAML frontmatter: `py -3 -c "import yaml,io; t=io.open('workflows/video-run.md',encoding='utf-8').read(); yaml.safe_load(t.split('---')[1]); print('YAML OK')"` → `YAML OK`.
- [ ] **Step 6: Commit** `workflows/video-run.md` — `feat(fyt): image-review is a real DAG node; render can no longer fire on "PNGs exist"`.

### Task 2: third `review_status` state in the render gate

**Files:**
- Modify: `.claude/skills/render-builder/scripts/render.py` (`resolve_scene_files`, ~line 192)
- Test: `.claude/skills/render-builder/scripts/test_resolve_scene_files.py` (extend existing)

**Interfaces:**
- Consumes: existing manifest entry shape `{"verified": {"scene": bool, "rig": bool}, ...}`.
- Produces: manifest entries MAY carry `"review_status": "unreviewed"|"verified"|"parked"` and `"parked_reasons": [str]`. Shippable ⇔ `review_status == "verified"`, or (when `review_status` absent) legacy `verified.scene and verified.rig`. `parked` fails with reason string `parked: <'; '.join(parked_reasons)>`; `unreviewed`/missing entry fails with the existing `gate` reason. Tasks 3, 8, 11 rely on exactly these semantics.

- [ ] **Step 1: Read** `resolve_scene_files` and the existing `test_resolve_scene_files.py` to learn the test harness's fixture builder.
- [ ] **Step 2: Write failing tests** (extend the existing suite, reusing its fixture helpers; adapt helper names to what the file actually uses):

```python
def test_review_status_verified_resolves(self):
    # entry: {"review_status": "verified"} and NO legacy verified booleans -> shippable
    ...asserts shot resolves...

def test_review_status_parked_fails_with_reasons(self):
    # entry: {"review_status": "parked", "parked_reasons": ["L12 lettering CHECKIG", "rig drift"]}
    # -> not shippable, failure reason startswith "parked:" and contains "CHECKIG"
    ...

def test_review_status_unreviewed_fails_as_gate(self):
    # entry: {"review_status": "unreviewed", "verified": {"scene": True, "rig": True}}
    # review_status is authoritative when present: still NOT shippable, reason == "gate"
    ...

def test_legacy_manifest_without_review_status_keeps_old_behavior(self):
    # {"verified": {"scene": True, "rig": True}} -> shippable; {"scene": True, "rig": False} -> gate
    ...
```

- [ ] **Step 3: Run** `py -3 .claude/skills/render-builder/scripts/test_resolve_scene_files.py` → new tests FAIL.
- [ ] **Step 4: Implement** in `resolve_scene_files`: where the S2 check currently reads `v = (entry or {}).get("verified") or {}`, first read `rs = (entry or {}).get("review_status")`. If `rs` is not None: shippable only when `rs == "verified"`; `rs == "parked"` → reason `"parked: " + "; ".join(entry.get("parked_reasons") or ["no reasons recorded"])`; anything else → reason `"gate"`. If `rs` is None: existing boolean logic unchanged.
- [ ] **Step 5: Run the full file** — all tests PASS, none of the pre-existing tests broken.
- [ ] **Step 6: Commit** both files — `fix(render): third review state — parked is representable, honest, and not shippable`.

### Task 3: layered shots can no longer skip verification

**Files:**
- Modify: `.claude/skills/render-builder/scripts/render.py` (`resolve_scene_files` layered/fallback path)
- Test: `.claude/skills/render-builder/scripts/test_resolve_scene_files.py`

**Interfaces:**
- Consumes: `layered_ids` param (from `motion_plan.cutout_layer_ids`), Task 2's `review_status` semantics.
- Produces: membership in `layered_ids` (or inline-fallback source) exempts a shot ONLY from the `scenes/<id>.png` existence check (S1) — the S2 manifest `review_status`/verified check applies to every shot whenever `scenes/manifest.json` exists. **Compatibility carve-out (deliberate):** a legacy manifest with NO entry at all for a layered shot passes (old manifests never listed layered shots); an entry that exists is always enforced. `stamp_review.py` (Task 5) always writes entries for layered shots, so new runs are fully gated.

- [ ] **Step 1: Read** the `is_fallback` branch in `resolve_scene_files` (currently `is_fallback` skips S2 entirely).
- [ ] **Step 2: Write failing tests:**

```python
def test_layered_shot_with_parked_entry_fails(self):
    # sid in layered_ids, manifest entry review_status="parked" -> NOT shippable, reason "parked: ..."
    # (this is the wells-fargo hole: 119/119 exempted)
    ...

def test_layered_shot_with_verified_entry_resolves_without_png(self):
    # sid in layered_ids, entry review_status="verified", NO scenes/<id>.png on disk -> shippable
    ...

def test_layered_shot_with_no_entry_resolves_legacy(self):
    # sid in layered_ids, manifest exists but has no entry for sid -> shippable (compat carve-out)
    ...

def test_all_flagged_manifest_resolves_nothing(self):
    # 3 shots (1 layered w/ entry, 2 plain), all review_status="parked" -> 0 resolve, 3 failures
    ...
```

- [ ] **Step 3: Run** → FAIL (parked layered shot currently resolves).
- [ ] **Step 4: Implement:** restructure so `is_fallback` short-circuits only the PNG-existence requirement; the manifest lookup + Task-2 status logic runs for every sid that HAS an entry. No entry + fallback → shippable (carve-out); no entry + not fallback → existing `gate` behavior.
- [ ] **Step 5: Run full render-builder suite** (`for t in .claude/skills/render-builder/scripts/test_*.py; do py -3 "$t" || break; done`) → all PASS.
- [ ] **Step 6: Integration proof against the real defect:** `py -3` one-liner (or tiny throwaway script, not committed) loading `channels/the-second-take/videos/2026-07-19-wells-fargo/assets/scenes/manifest.json` + that video's motion plan and calling `resolve_scene_files` the way `build_motion.py` does. Expected: **0 of 119 resolve** once entries carry flagged/parked status; record actual counts in the task report. (Do NOT modify any wells-fargo file.)
- [ ] **Step 7: Commit** — `fix(render): layered shots are exempt from the PNG check, never from verification`.

### Task 4: companion update to `compile.videoRun.test.ts` (main-based)

**Files:**
- Modify: `dashboard/server/workflows/compile.videoRun.test.ts` — on a NEW branch `claude/fyt-video-run-test` cut from `origin/main` in a temp worktree (`git worktree add ../fyt-test-fix origin/main -b claude/fyt-video-run-test` from repo root; remove the worktree when done).

**Interfaces:**
- Consumes: Task 1's exact node shape (`image-review`, `dependsOn: [images, motion]`, render deps swap).
- Produces: updated assertions; PR note that this branch must merge together with `claude/faceless-live-import`.

- [ ] **Step 1:** In the temp worktree, update the stage-list assertion (~line 92) to include `['image-review', <title from Task 1>]` between `images` and the next stage, and the DAG assertions: add `expect(deps['image-review']).toEqual(['images', 'motion']);` and change `expect(deps.render).toEqual([...])` to `['audio-plan', 'image-review', 'metadata', 'motion', 'shorts']`.
- [ ] **Step 2:** Attempt `npx vitest run dashboard/server/workflows/compile.videoRun.test.ts` from the temp worktree's `dashboard/` (install deps if `node_modules` missing and install is quick; the loader reads `video-run.md` across worktrees, so with the faceless-import worktree present it should see the NEW def and pass. If deps can't install cleanly, note it — the edit is assertion-only and Daniel's merge CI will prove it).
- [ ] **Step 3: Commit + push** the branch — `test(dashboard): video-run DAG assertions learn the image-review node` — with a body noting "merge together with claude/faceless-live-import".

### Task 5: `stamp_review.py` — the honest stamp writer + wells-fargo `plan_pass2.py` deletion

**Files:**
- Create: `.claude/skills/image-generation/scripts/stamp_review.py`
- Test: `.claude/skills/image-generation/scripts/test_stamp_review.py`
- Delete: `channels/the-second-take/videos/2026-07-19-wells-fargo/assets/plan_pass2.py`
- Modify: `.claude/skills/image-generation/SKILL.md` (batched-review section: document `review_status` + the stamp step)

**Interfaces:**
- Consumes: `_review/merged.json` ruling shape — READ the wells-fargo `assets/_review/merged.json` (committed) first and mirror its actual schema.
- Produces: CLI `py -3 stamp_review.py <video_dir>` reading `<video_dir>/assets/_review/merged.json`, writing `review_status` + `parked_reasons` onto every reviewed shot's entry in `<video_dir>/assets/scenes/manifest.json` (creating entries for layered shots reviewed via plates/cutouts). Ruling→status map: clean → `verified`; any defect ruling → `parked` with the ruling strings as `parked_reasons`. Never writes `verified: true` booleans. Prints a summary line `stamped: N verified, M parked`. Tasks 1, 11, 14 invoke it by this exact CLI.

- [ ] **Step 1:** Read wells-fargo `merged.json` + `scenes/manifest.json` to pin real schemas (quote them in the test fixtures).
- [ ] **Step 2: Write failing tests** with tmp-dir fixtures: (a) clean ruling → `review_status: "verified"`; (b) defect ruling → `parked` + reasons copied; (c) shot in merged.json but absent from manifest (layered) → entry created with `review_status`; (d) manifest entries NOT in merged.json are left byte-identical; (e) summary line correct.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement** (stdlib json only, atomic write via temp file + rename). **Step 5: Run** → PASS.
- [ ] **Step 6:** `git rm channels/the-second-take/videos/2026-07-19-wells-fargo/assets/plan_pass2.py` (it IS the hand-orchestration artifact; run-001 handoff orders its deletion).
- [ ] **Step 7:** Update `image-generation/SKILL.md` batched-review section: the review ends with `stamp_review.py`; document the three states and that generating agents never run the stamp.
- [ ] **Step 8: Commit** all four paths — `feat(image-review): stamp_review writes the honest three-state verdict; delete the hand-orchestration artifact`.

### Task 6: `compliance-check` skill

**Files:**
- Create: `.claude/skills/compliance-check/SKILL.md`
- Create: `.claude/skills/compliance-check/scripts/compliance_check.py`
- Test: `.claude/skills/compliance-check/scripts/test_compliance_check.py`
- Modify: `.claude/skills/README.md` (move compliance-check from "Skills to build" to "Built")

**Interfaces:**
- Consumes: `<video_dir>/assets/render.manifest.json`, `metadata.json`, `assets/scenes/manifest.json`, `assets/thumbnail.png`, `audio-plan.json`, `assets/library/manifest.json`, `research.md`, `script.md`.
- Produces: CLI `py -3 compliance_check.py <video_dir>` → writes `<video_dir>/compliance-report.md`, exit 0 = PASS, 1 = FAIL. Report has `## Mechanical checks` (each line `PASS|FAIL — <check>`) and `## Provenance (warn-level)`. Task 11 (runner) and Task 15 (poyais) invoke this CLI; publish-queue (Task 9) preflights on exit code.

Mechanical checks (each its own function returning `(ok: bool, detail: str)`):
1. render manifest: `state == "rendered"` (or the manifest's actual success marker — read wells-fargo's to pin the field), LUFS/duration/splice gate fields green.
2. metadata: title ≤100 chars; description ≤5000 bytes; ≤500 total tag chars; `category_id` present; chapters strictly monotonic and < duration.
3. `privacy_status == "private"` and `contains_synthetic_media == true`.
4. licensing: every licensed asset id in `audio-plan.json` + `library/manifest.json` (fields naming a license/attribution — read the real files to pin field names) appears in a credit block in the description; no orphan credits.
5. `assets/thumbnail.png` exists and is exactly 1280×720 (PIL).
6. scene-review invariant: every entry in `scenes/manifest.json` shippable per Task-2 semantics; any `parked`/`unreviewed` → FAIL naming the shots.

Provenance section: map `[F-NN]`-style citations in `script.md` to `research.md`'s ledger; WARN on any 200-word window citing a single source ≥5 times consecutively; never affects exit code.

- [ ] **Step 1:** Read the real wells-fargo/poyais artifacts to pin every field name; write SKILL.md (mirror an existing tail-adjacent skill's SKILL.md structure, e.g. `voiceover`).
- [ ] **Step 2: Write failing tests** — tmp-dir fixture video with every check passing (tiny PIL-made 1280×720 png), then one test per check flipping exactly one thing to FAIL (7+ tests), plus provenance WARN test proving exit stays 0.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** — `feat(fyt): compliance-check — the mechanical+provenance Gate-3 report`.

### Task 7: thumbnail finalizer

**Files:**
- Create: `.claude/skills/image-generation/scripts/finalize_thumbnail.py`
- Test: `.claude/skills/image-generation/scripts/test_finalize_thumbnail.py`
- Modify: `.claude/skills/image-generation/SKILL.md` (§Thumbnail: document the finalize step) and `workflows/video-run.md` is NOT touched (thumbnail is a B2 runner step, not a DAG node — segments cover it).

**Interfaces:**
- Consumes: a chosen thumbnail candidate PNG (generated by the existing forge thumb flow from `metadata.json`'s `thumbnail.primary` concept).
- Produces: CLI `py -3 finalize_thumbnail.py <candidate.png> <video_dir>` → `<video_dir>/assets/thumbnail.png`, exactly 1280×720: center-crop to 16:9 then LANCZOS resize; refuses (exit 1) upscales from source narrower than 640px; idempotent overwrite. Tasks 6 and 15 depend on the output path/size.

- [ ] **Step 1: Write failing tests:** 1920×1080 → 1280×720; 1600×1200 (4:3) → center-cropped 16:9 then 1280×720; 320×180 → exit 1 "refusing to upscale"; output re-run is byte-stable.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (PIL only). **Step 4: Run** → PASS.
- [ ] **Step 5:** SKILL.md §Thumbnail: after review of thumb candidates, `finalize_thumbnail.py` produces the publishable file; challengers stay in `assets/thumbs/` for future A/B.
- [ ] **Step 6: Commit** — `feat(fyt): thumbnail finalizer — metadata concept to publishable 1280x720`.

### Task 8: shot-board generator (Gate 2 surface)

**Files:**
- Create: `.claude/skills/shot-board/SKILL.md`
- Create: `.claude/skills/shot-board/scripts/build_board.py`
- Test: `.claude/skills/shot-board/scripts/test_build_board.py`
- Modify: `.claude/skills/README.md` (add to Built/Utility)

**Interfaces:**
- Consumes: `<video_dir>/shots.json`, `shots.motion.json`, `script.md`, `assets/library/manifest.json` (+ images), `assets/scenes/*.png`, `assets/scenes/manifest.json` (Task 2 `review_status`).
- Produces: CLI `py -3 build_board.py <video_dir> [-o out.html]` → self-contained `board.html` (default `<video_dir>/assets/board.html`, gitignored like other media-derived artifacts): `<title>` = video slug; a `## Cast & props` section (every library ref: data-URI image, id, description); shot cards in story order, each with `data-shot-id`, downscaled JPEG data-URI (~480px wide, PIL, quality 70), shot id, covered script lines, motion intent (camera move/hold/rig flags from the motion plan), `review_status` badge + `parked_reasons`/lint flags. Missing image → visible `MISSING` placeholder, never a crash. The orchestrator publishes this file as the per-video Claude artifact (stable URL per video, republished per iteration round).

- [ ] **Step 1:** Read poyais's `shots.json`/`shots.motion.json` structure to pin field names for script-line coverage + motion intent.
- [ ] **Step 2: Write failing tests** (tmp fixture: 2 shots + 1 library ref with tiny PIL PNGs; 1 shot `verified`, 1 `parked`): output exists, is single-file (no `src="http`/`href="http` external refs), contains both `data-shot-id`s in shots.json order, contains the parked badge + reason text, contains cast section id, missing-PNG shot renders `MISSING`.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement** (stdlib + PIL; embedded CSS; no JS needed v1). **Step 5: Run** → PASS.
- [ ] **Step 6: Smoke on the real thing:** `py -3 build_board.py channels/the-second-take/videos/2026-07-04-poyais` — must complete; note file size (must be < 20 MB; if over, drop JPEG quality to fit).
- [ ] **Step 7: Commit** (skill files + README; board.html stays untracked) — `feat(fyt): shot-board generator — the Gate-2 human surface`.

### Task 9: `publish-queue` skill

**Files:**
- Create: `.claude/skills/publish-queue/SKILL.md`
- Create: `.claude/skills/publish-queue/scripts/publish_preflight.py`
- Create: `.claude/skills/publish-queue/scripts/write_publish_record.py`
- Test: `.claude/skills/publish-queue/scripts/test_publish_queue.py`
- Modify: `.claude/skills/README.md`

**Interfaces:**
- Consumes: Gate-3 approval (recorded by the runner), `compliance-report.md` exit state, `metadata.json`, `assets/final.mp4`.
- Produces: `publish_preflight.py <video_dir>` exits 0 only when: compliance report exists with PASS, `assets/final.mp4` exists, and NO `publish-record.json` exists (idempotency — exit 2 with "already published: <video_id>" if present). `write_publish_record.py <video_dir> --video-id <id>` writes `publish-record.json`: `{"video_id", "url": "https://www.youtube.com/watch?v=<id>", "uploaded_at" (ISO, caller-supplied via --timestamp), "privacy_status": "private", "file_sha256", "metadata_snapshot": {...full metadata.json...}}`. The UPLOAD itself is agent-work per SKILL.md: in-session T3, after preflight, via youtube-uploader MCP (`upload_video` with title/description/tags from metadata, `privacyStatus: private`), then immediately write the record. Credentials never leave the MCP.

- [ ] **Step 1: Write failing tests:** preflight passes on a good fixture; fails on missing compliance PASS / missing final.mp4; exit 2 + message when record exists; record writer produces the exact schema incl. correct sha256 of a fixture mp4 (any bytes) and refuses to overwrite an existing record.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: SKILL.md:** the full T3 procedure — Stage-0 law banner (human approves every publish; upload is always `private`; API cannot make public), preflight → MCP upload → record → the two deliberately-manual Studio steps (thumbnail set, private→public). Include the failure protocol: partial upload leaves no record and is safe to retry in-session.
- [ ] **Step 6: Commit** — `feat(fyt): publish-queue — idempotent human-gated private upload`.

### Task 10: `analytics-reporter` skill + dashboard generator

**Files:**
- Create: `.claude/skills/analytics-reporter/SKILL.md`
- Create: `.claude/skills/analytics-reporter/scripts/pull_analytics.py`
- Create: `.claude/skills/analytics-reporter/scripts/build_dashboard.py`
- Create: `.claude/skills/analytics-reporter/scripts/append_digest.py`
- Test: `.claude/skills/analytics-reporter/scripts/test_analytics.py`
- Create: `DASHBOARD.md` (org root; holds the stable artifact URL once first published)
- Modify: `.claude/skills/README.md`

**Interfaces:**
- Consumes: env names `YOUTUBE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN` (runtime only, never logged — the token-refresh POST is the ONLY network call site, isolated in one function `_access_token()` so tests never touch it); `publish-record.json`s for video-id discovery.
- Produces: `pull_analytics.py --channel <name> [--video <slug>]` → raw JSON `analytics/<channel>/raw/<ISO-date>.json` + rollup `analytics/<channel>/rollup.json` (per-video: views, watch time, avg view duration, retention curve points, impressions CTR, subs gained). `build_dashboard.py [-o analytics/dashboard.html]` renders ALL channels from rollup.json files: tab per channel, per-video drilldown, retention polyline + CTR as inline SVG, self-contained, theme-neutral. `append_digest.py --channel <name>` appends a dated digest block to `channels/<name>/performance.md`. Fetch/parse split: `_fetch_report(...)` (urllib, untested) vs pure `parse_report(json_dict) -> rows` + `rollup(rows)` (tested).

- [ ] **Step 1: Write failing tests** against canned YouTube Analytics API response JSON (columnHeaders/rows shape — write fixtures from the documented v2 response format): parse → rows; rollup merges two pulls (later pull wins per video+date); dashboard HTML contains channel tab id, video slug, an `<svg` retention polyline, and no external refs; digest appender appends exactly one dated block and is idempotent per date (re-run same date replaces, not duplicates); a `test_no_secret_leak` asserting the modules' source never string-formats the token env values into anything written to disk (grep the file for `REFRESH_TOKEN` — allowed only inside `_access_token`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (stdlib only). **Step 4: Run** → PASS.
- [ ] **Step 5: SKILL.md:** run procedure, freshness caveat (YT lags 24–48h), failure = keep last-good dashboard (build_dashboard refuses to write if rollups are missing/empty), artifact republish instruction (same stable URL, link kept in `DASHBOARD.md`).
- [ ] **Step 6:** `DASHBOARD.md`: purpose + "URL: (pending first publish)" placeholder line the orchestrator fills at first artifact publish.
- [ ] **Step 7: Commit** — `feat(fyt): analytics-reporter — read-only pulls, file-backed dashboard, performance digests`.

### Task 11: `agents/fyt-runner.md` + fyt-producer tombstone

**Files:**
- Create: `agents/fyt-runner.md` (repo root)
- Modify: `agents/fyt-producer.md` → tombstone
- Create: `memory/fyt-runner.md` (repo root; seeded with the run-001 + poyais lessons) — NOTE: memory/ is coordination; commit it on this branch but flag in the PR that it normally lives via ops.

**Interfaces:**
- Consumes: every CLI from Tasks 5–10 by exact invocation; the four segment scripts from Task 14 by path.
- Produces: the agent definition the orchestrator dispatches for all future FYT runs.

- [ ] **Step 1:** Read `agents/fyt-producer.md` fully + operating-law §G + the synthesis spec Part 3.
- [ ] **Step 2: Write `agents/fyt-runner.md`** with frontmatter `id: fyt-runner`, `role: manager`, `runtime: claude`, `model: claude-opus-4-8`, `runner-bound: false`. Required content, gates-first:
  - Core law banner (spec's three-sentence law, verbatim).
  - The gate spine: preamble → GATE 1 (script, Daniel) → HARD lints → spend authorization → image-review + stamp → GATE 2 (shot board, Daniel, iteration loop) → verified render gate → compliance → GATE 3 (watch-through + report + publish approval, Daniel) → publish-queue (T3) → Studio manual steps. Each gate: who holds it, what artifact it reads, what unblocks it, what "parked" means there.
  - Stages-between-gates: the 13 stage sections carried over from fyt-producer (exact commands, reads/writes, reality-check numbers) plus the new tail stages (thumbnail via `finalize_thumbnail.py`, compliance via `compliance_check.py`, board via `build_board.py`, publish per publish-queue SKILL.md, analytics per analytics-reporter SKILL.md).
  - R1–R12 carried over verbatim with their teaching failures; corrections: the "pinned byte-identical fixture" claim replaced with "compile.videoRun.test.ts loads the real def across worktrees and asserts the DAG — coordinate test updates when the DAG changes"; drift-table rows now folded into the def are dropped.
  - Run modes: full run / resume-from-gate / single-stage / targeted repair — with the rule "partial entry never skips a gate downstream of the change".
  - Money rules: card-authorised spend, paid stages at most once per approved script, vo.mp3 reuse law, repair-and-resume on cached workflow runs.
  - Self-learning: append to `memory/fyt-runner.md` + `knowledge/` per §G-route; run report per video at `<video_dir>/run-report.md`.
- [ ] **Step 3:** Replace `agents/fyt-producer.md` body with a tombstone: superseded by `agents/fyt-runner.md` 2026-07-20 per the synthesis spec; full text in git history at `f0c73cb^`; do not dispatch.
- [ ] **Step 4:** Seed `memory/fyt-runner.md` with 5–8 durable lessons distilled from the run-001 handoff + poyais R6–R12 pickups (seeded-rig law, re-author-don't-retry lettering law, review-before-render, honest-stamp law, delayRender retry-once).
- [ ] **Step 5: Commit** all three — `feat(fyt): fyt-runner — the gates-first conductor; fyt-producer tombstoned`.

### Task 12–14: workflow segment scripts (`segment-a`, `segment-b1`, `segment-b2`, `segment-c`)

**Files:**
- Create: `workflows/segments/segment-a.workflow.js`, `segment-b1.workflow.js`, `segment-b2.workflow.js`, `segment-c.workflow.js`
- Create: `workflows/segments/README.md`

**Interfaces:**
- Consumes: stage skills by SKILL.md path; `args = {channel, slug, videoDir}` (+ per-segment extras: b1 takes `resumeShotIds` for targeted regen; c takes `approvedBy` string that MUST be non-empty).
- Produces: Workflow-tool scripts the runner launches; each returns `{segment, gates: {...}, artifacts: [...]}`. Cut points exactly at the spec's gates.

Shape rules for all four (spelled out in README.md): `export const meta` literal with phases matching the stage names; one `agent()` per stage, prompt = "Follow <skill path> for <videoDir>; write staged output per the single-writer rule; your final text is the JSON gate result `{stage, ok, artifact, notes}`" with a `schema` pinning that shape; stage order/deps mirror `video-run.md` (source of truth — say so in a comment); a failed gate result stops the segment and returns what completed (the runner repairs and RESUMES the same run via `resumeFromRunId` so paid stages stay cached); NO paid stage runs unless `args.spendAuthorized === true` (a-, b1-only); segment-c's first line throws unless `args.approvedBy` is a non-empty string (Gate 3 record).

- Segment A: idea → research → script → judge-gate; returns for GATE 1.
- Segment B1: shorts ∥ metadata (parallel) → shots → motion → [images ∥ voiceover] (parallel; both paid-guarded) → image-review (conductor-side agent runs the batched review + `stamp_review.py`) → board build (`build_board.py`); returns for GATE 2.
- Segment B2: audio-plan → render (with `--motion-plan`) → verify → thumbnail (`finalize_thumbnail.py` after thumb review) → compliance (`compliance_check.py`); returns for GATE 3.
- Segment C: preflight (`publish_preflight.py`) → MCP upload → `write_publish_record.py`; in-session T3.

- [ ] **Step 1:** Write README.md (shape rules above + "derived from video-run.md; the def is the DAG of record").
- [ ] **Step 2:** Write the four scripts.
- [ ] **Step 3: Syntax check:** `node --check workflows/segments/segment-*.workflow.js` (each) → no errors. (Workflow scripts are plain JS — no TS annotations, no Date.now/Math.random.)
- [ ] **Step 4: Commit** — `feat(fyt): committed workflow segments — the deterministic spine between the human gates`.

### Task 15: live test — poyais through the tail

Orchestrator-led (this is the run, not a build task). Preconditions: Tasks 1–14 merged on the branch; Daniel present for gates.

- [ ] **Step 1:** Thumbnail: check whether poyais already has usable thumb candidates in assets (likely from prior rounds); if none, ASK Daniel before any paid generation; then `finalize_thumbnail.py` → `assets/thumbnail.png`.
- [ ] **Step 2:** `py -3 .claude/skills/compliance-check/scripts/compliance_check.py channels/the-second-take/videos/2026-07-04-poyais` → report lands; expect honest FAILs/WARNs (poyais's manifest predates review_status; the report carries the run-001 lettering caveat). Review with Daniel.
- [ ] **Step 3:** `build_board.py` on poyais → publish as Claude artifact; record URL in run report.
- [ ] **Step 4:** GATE 3 with Daniel: watch-through already passed for content; he reviews compliance report + board.
- [ ] **Step 5:** On approval: segment-c (preflight → youtube-uploader MCP auth check → upload private → publish-record.json). Daniel does the two Studio steps manually.
- [ ] **Step 6:** If Daniel's analytics OAuth token is in `.env`: first `pull_analytics.py` + `build_dashboard.py` + artifact publish + fill `DASHBOARD.md`. Otherwise hand Daniel the 10-minute checklist and mark analytics-live as pending.

### Task 16: close-out

- [ ] Update `STATE.md` (org) — tail built, gate fixes landed, poyais publish state, wells-fargo parked status unchanged.
- [ ] Append lessons to `memory/<agent-id>.md` per constitution; update boss auto-memory resume points.
- [ ] Push `claude/faceless-live-import`; open PR to main (body: scope, the compile.videoRun.test.ts companion branch `claude/fyt-video-run-test` must merge together, wells-fargo uncommitted-edits note, budget.yaml flag for Daniel).

---

## Self-review notes

- Spec coverage: Part 1 → Tasks 1–5; tail §1–5 → Tasks 6–10; Part 3 → Tasks 11–14; live test → Task 15; integration notes → Tasks 4, 16. Budget flag → Task 16 PR body. No gaps found.
- Type consistency: `review_status` semantics defined once (Task 2) and consumed by 3, 5, 6, 8; CLIs referenced by exact invocation throughout.
- Deliberate deviations from full-TDD-verbatim-code: tests are specified as named cases with pinned assertions rather than full listings where they depend on reading real on-disk schemas first (merged.json, render.manifest.json) — implementers must pin fixtures from the real files, which is stated in each such step.
