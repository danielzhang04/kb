# IG-saved → kb build-ideas research handoff — 2026-08-17

**Topic:** Mined the top recent AI/dev-tooling/dashboard videos from Daniel's Instagram saves, ran full frames+transcript vision on each, and produced a deduped, ranked "things to build for a kb platform overhaul" report. Research/synthesis only — no code built.

**Deliverable:** `docs/research/2026-08-17-ig-saved-ai-build-ideas.md` — 37 reels → 90 candidates → **30 ranked ideas** (8 build-now / 14 high-value / 8 interesting-later) + a 19-item dashboard/UI-UX catalog + 8 cross-cutting themes + 37-row appendix.
**Readable artifact (private):** https://claude.ai/code/artifact/7e2a6ef4-3c81-4315-b665-2e00f334ff7a
**Branch:** `claude/boss-2026-08-17` (research artifacts committed here; media NOT committed — see below).

### What WORKED (with evidence)
- **Full IG→vision pipeline** — confirmed end-to-end on a real reel: `yt-dlp` downloaded the mp4 (no cookies), `video_watch` returned accurate frames (Composio "Pi Agent passed 20/30" board) + a clean whisper transcript. 37/37 reels downloaded and analyzed; 37 non-empty notes in `docs/research/_ig-saved/notes/`.
- **Toolchain self-provisioned (no admin)** — this box had ONLY yt-dlp; ffmpeg/ffprobe/whisper were absent (confirmed via PowerShell `where.exe`, not MSYS). Fixed by `pip install static-ffmpeg` + downloading whisper.cpp `whisper-blas-bin-x64.zip`, then copying ffmpeg.exe/ffprobe.exe/whisper-cli.exe + its DLLs into `…/Python313/Scripts` (already on PATH). Plugin `video_setup` then reported READY with NO session/MCP restart — the running MCP server's `where` sees files added to an on-PATH dir live.
- **4-phase agent pipeline, all model-verified** — 8 sonnet analysis agents (2 waves) + 3 opus synth workers + 1 opus merge + 1 opus reviewer, every model confirmed by transcript grep (`claude-sonnet-5` / `claude-opus-4-8`). Independent review returned 0 blocker / 2 major / 9 minor; all 11 findings applied and re-verified (dedup clean, 3 dropped dashboard/UI patterns added, stale `@00:27` timestamp gone).

### What Did NOT Work (and why)
- **`--cookies-from-browser chrome`** — failed ("Could not copy Chrome cookie database") because Chrome was running and held the cookie DB lock. Did NOT close Chrome (live IG session). Consequence: one auth-gated reel (`DcHocsYsVYA`, "Top 5 Claude MCPs") couldn't download; substituted the next save-order relevant video (`DbY9KatgSMi`), logged in `audit-log.md`.
- **Full-scroll grid accumulation for save-order** — Instagram virtualizes the saved grid (offscreen tiles drop from DOM), so a scroll-to-bottom accumulate REORDERED items and returned ~294 out of order. Fix that worked: capture at fresh `scrollTo(0,0)` in small steps, keep FIRST-seen order — the fresh-load top band is authoritative for "most recently saved."
- **Returning the full grid JSON inline** — a ~300-tile a11y/JSON dump exceeded the tool-result token cap. Fix: return compact fields only (id + 80-char alt).
- **First selection pass over-filtered** — I skipped recent "grifty-tone" AI reels and reached DEEP into old saves for dashboards. Daniel corrected twice: the great dashboard/UI-UX videos are RECENT saves, sales-tone ≠ no value. Wave-2 pulled in 17 recent-band videos I'd wrongly skipped; that's where most of the UI catalog came from.

### What Has NOT Been Tried Yet
- The **8 deeper "agentic-OS" reels** (Boris Cherny workflow, Anthropic masterclass, Agentic-OS-in-Fable-5 pt1/2, Obsidian second-brain, etc.) were downloaded to scratchpad but NOT analyzed, per Daniel's recent-only steer. mp4s still in scratchpad if wanted: `DYAL7pNk-1F DamEcWuPvX0 DawbfDGPLOe DYzNRMCPKEF DXjFy8EAcaV DaPF6rDgj2m DY5LnovjZ7j DaI8TNmsSm3 DaIaKA9Nspi`.
- **Building any of the 30 ideas.** This was research only. Natural first builds (highest impact×feasibility): #1 autonomy-graduation trust gate, #2 Git Timeline orchestration dashboard, #5 canonical metric-definitions layer.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `docs/research/2026-08-17-ig-saved-ai-build-ideas.md` | DONE | The ranked deliverable (reviewed, revised). |
| `docs/research/_ig-saved/manifest.json` | DONE | 37 videos: id/topic/url/author/date/caption/wave. |
| `docs/research/_ig-saved/audit-log.md` | DONE | Selection include/skip trail + the one substitution. |
| `docs/research/_ig-saved/notes/*.md` (37) | DONE | Per-video frames+transcript notes. |
| `docs/research/_ig-saved/candidates-A/B/C.md` | DONE | 90 raw candidates (pre-dedup). |
| `docs/research/_ig-saved/review-findings.md` | DONE | Independent review (0 blocker/2 major/9 minor, all applied). |
| `memory/claude-boss.md` | DONE | 2026-08-17 lessons appended (pipeline + toolchain + taste). |
| scratchpad `…/igmedia/*.mp4` (45) | EPHEMERAL | 37 analyzed + 8 deep unanalyzed; NOT committed (repo-bloat). |

### Exact Next Step
None required — the run is complete and the deliverable is reviewed and published. On resume, if Daniel wants to act: pick a build from the "Build now" tier (start #1 / #2 / #5) and run a normal plan→build→review wave; OR analyze the 8 deep agentic-OS reels (media already in scratchpad — re-download via yt-dlp if scratchpad was swept). The vision toolchain is provisioned and configured (`~/.claude-video-vision/config.json`: local / whisper-cpp / small).

### Load list
- `docs/research/2026-08-17-ig-saved-ai-build-ideas.md` — the deliverable
- `docs/research/_ig-saved/audit-log.md` — how the 37 were chosen
- `docs/research/_ig-saved/manifest.json` — video metadata + paths
- `memory/claude-boss.md` — 2026-08-17 section (pipeline + toolchain recipe reusable for any future IG/video research run)
- Artifact: https://claude.ai/code/artifact/7e2a6ef4-3c81-4315-b665-2e00f334ff7a
