# figment — resume point (2026-08-31, late session)

Branch `claude/figment`. Everything below is committed unless marked untracked.

## Done

**Research (r1-r9 + boards):** complete, committed under `orgs/figment/research/`.
Key decisions in `w0-decision-board.md` (v3) and `arm-a-findings.md`.

**QA toolkit** (`orgs/figment/pipeline/`, committed, tested end-to-end):
- `qa_stamp.py` — three-state verdict writer (verified/parked/unreviewed), fail-closed.
- `build_grading_board.py` — offline HTML board, data-URI inlined, **blind mode**.
- `blind_pool.py` — pools arms under anonymised names, key held outside pool,
  `reveal` de-anonymises after grading. `README.md` has the end-to-end commands.

**Local stack** `C:\Users\danie\tools\ComfyUI` (own venv, torch 2.11.0+cu128, CUDA on
RTX 4070 8 GB): RealVisXL_V5.0_fp16 + IP-Adapter Plus-Face + CLIP-ViT-H (2.53 GB, the
truncated one was replaced) + T2I-Adapter OpenPose SDXL. Start:
`venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188`, drive via HTTP API.

**Arm A results** — realism PASS, framing FIXED, identity ~70% (see arm-a-findings.md).
Recipe of record:
- full-body -> OpenPose skeleton ControlNet 0.6-0.7 + IP-Adapter 0.3  (10/10)
- profile   -> no ControlNet, IP-Adapter 0.4-0.5 with start_at 0.8-0.85 (6/6)
- close/bust/mid -> IP-Adapter 0.35, no ControlNet
- unsolved: "three-quarter" renders as a mild head-turn only.

## In flight

LoRA training-set generation, `personas/trial-01/lora-set/` (untracked): 39 shots
queued, staging in `_staging/`, agent culls to ~30 keepers + writes `captions/`
(trigger token `tr1al01woman`; captions describe only what VARIES). Agent instructed to
report once at completion. NOTE: harness kills long background bash waits (~10 min) —
do not rely on them; let the agent's monitor report.

## Next

1. LoRA training on the completed set (local, free). Pins the one unbounded estimate:
   training wall-clock on an 8 GB card. r1 said 12 GB min for SDXL LoRA — may need
   optimisation flags or a rented pod; test and report honestly.
2. Generate arm A's 10 trial images WITH the LoRA, per `trial-protocol.md`.
3. Blind-grade arm A vs Eromify (arm C) with `blind_pool.py`.

## Blocked on Daniel

- **Eromify (arm C)**: Builder tier bought ($36/yr). MCP + agent are gated to higher
  tiers, so generation is MANUAL via their studio. Upload
  `personas/trial-01/anchor.png` as the influencer (same anchor our arm uses = fair
  test), run the 5 scenes in `personas/trial-01/studio-prompts.md`, keep first result
  each time, save as 01a..05b, tell Claude the path.
- Civitai account + Buzz (arm B). IG professional test account + Meta token (Test 0).
  Fanvue written confirmation. See `daniel-provisioning.md`.

## Do not repeat

- `npx eromify-mcp` — package does NOT exist on npm (404, zero registry hits).
  Dependency-confusion shape. Never run it.
- Their docs coach renaming the connector to evade AI safety systems. The MCP server
  was registered as `creator-studio` for Daniel's own discretion, then REMOVED when the
  tier gate was found. Re-add with `claude mcp add --transport http --scope user` if he
  ever upgrades.
