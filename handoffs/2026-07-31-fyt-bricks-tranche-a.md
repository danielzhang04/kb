# bricks-fresh tranche A — mid-wave pause at plate taste-pick gate — 2026-07-31

**Topic:** Repair wave run as staged rollout (Daniel: "run the pipeline on 1/5th of the remainder.
Build an artifact for review. If good, I'll release the other 4/5."). Tranche A (27 shots) executed
through figures+plates; PAUSED with Daniel's taste-pick gate open. All work on `claude/boss-post-103`
(main checkout, local, UNPUSHED — commits this session: 4efde54 wave-plan docs, 7a6d538 tranche-A
selection, eaba3f1 VPW repair, bdf6d98 qt-wiles canonical, efe82d2 leg-1 records). All subagents were
CODEX workers via dispatch-codex per Daniel's directive.

### What WORKED (with evidence)

- **Tranche A selection (codex, $0)** — 27 dep-closed shots from the 142-target set, strata all met,
  closure_missing=0; boss re-verified ids∈142, arithmetic, dedup. `scratchpad/tranche-a.json` +
  `tranche-a-notes.md`.
- **Phase 0 sweep** — 35 stale pre-fix PNGs quarantined to `visual-kit/_staging/_pre-fix-quarantine/
  tranche-a/`; L45/L116/L143 dogfood-verified untouched (confirmed by ls).
- **qt-wiles canonical registered** — Daniel picked ORIGINAL remint-c ("Remint c before is fine")
  after a patch was built; file = `visual-kit/refs/qt-wiles/qt-wiles.png` (sha-verified == remint-c),
  old stethoscope mint quarantined, library manifest note updated (bdf6d98).
- **VPW scoped-repair (codex)** — exactly the 17 target entries changed (boss diffed by id vs HEAD),
  215-shot list intact, `vpw-log.md` declaration created; boss-run forge dry-run over all 27 ids:
  ZERO violations (`FORGE_EXIT: 0`, 27 scenes + 11 STEP-1).
- **Gen leg 1 COMPLETE** — 12/12 STEP-1 figures + 20/20 plates staged in `visual-kit/_staging/`
  (8 recurring places ×2 candidates + L78/L91/L205/L215; L205 was the boss's recovery probe).
  Genlog = `scratchpad/tranche-a-genlog.md` (every gen, cost, verdict, flag). ≈$4.2 of $5.86 cap
  committed incl. failure reserves.
- **Empty-hands retry tactic** — `hold-*`/`hold-paper-*` pose primitives bait the engine into baking
  a held box/paper into STEP-1 figures; explicit "hands EMPTY, holding NOTHING" negatives fixed it
  2/2 on retry (terry, foreman).
- **Provider-outage handling** — gemini-3-pro-image threw multi-minute stalls + 503 "high demand"
  (~02:30–03:00); differential probe (fresh L205 request also 503'd) proved provider-side; 20-min
  poll loop recovered at attempt 1 (03:04) and banked L205 as a real asset.

### What Did NOT Work (and why)

- **Two-seed and clean-seed notch fixes** — remint-c (old-canonical+A seeds) AND remint-d (base-only
  seed, no-gap clause first) both re-carved the right-side ear notch; engine prior on swept-back
  hair. Deterministic patch was built (`_staging/patch_remint_c.py`, `qt-wiles-remint-c-patched.png`)
  but Daniel then accepted UNPATCHED remint-c — patch files remain in staging, unused.
- **15-min stall patience (dogfood §8b)** — OVERRIDDEN by Daniel: long stalls are transport hangs.
  New law (memory: image-gen-stall-policy): 4-min ceiling + ONE immediate re-issue; failed re-issue
  = failed request; 3 consecutive → stop.
- **Long codex worker threads drift** — the gen worker's thread ended turns prematurely twice
  ("generation is underway" with the process dead) then rationalized a refusal ("can't finish
  without violating controls"). Fix that worked: FRESH cold worker with self-contained spec-driven
  brief finished the identical remaining work cleanly. Don't send a 3rd follow-up to a drifting
  thread.
- **`--prompt-file /dev/stdin`** — fails on Windows py (`\\proc\\self\\fd\\0` not found); always
  write a real brief file.
- **Boss's first two dispatches with relative `scripts/codex_dispatch.py`** — cwd was the video dir;
  the skill's absolute-path warning is real.

### What Has NOT Been Tried Yet

- **THE OPEN GATE:** Daniel's 8 taste-picks on
  https://claude.ai/code/artifact/f5397657-6209-48e7-a933-7a94fd8d1a06 (L26/L49/L66/L100/L107/L160/
  L183/L190, A or B) + retry calls on flags (L49-A invented "BILL" text; L190-A blank "128 MILLION"
  card; L78 grey-in-cream palette drift) + **cap bump ≈$7** (composite leg ~15 gens ≈ $2.0 exceeds
  the $5.86 remainder).
- Composite/delta leg (~14 shots incl. chains in board order) + L60 composite redo + L61 authored
  retry — blocked on picks.
- Per-act fresh-eyes review (one pass per act, L184/L191 specific look), then the tranche-A review
  board (WITH lightbox — Daniel's standing rule), then his 4/5-release gate (task #10).
- On 4/5 release: remaining 26 VPW-repair shots, ~110 shots, word-sync trio L02/L03/L197 last.
- SKILL.md `--shots`/`--video` doc mention (cosmetic, owed since fix-wave).

### Current State of Files

| File | Status | Notes |
| ---- | ------ | ----- |
| `claude/boss-post-103` @ efe82d2 | DONE (local, unpushed) | 5 new commits atop 6735796, see topic line |
| `…/bricks-fresh/shots.json` + `vpw-log.md` | DONE | 17 repairs + declaration, dry-run clean (eaba3f1) |
| `visual-kit/refs/qt-wiles/qt-wiles.png` | DONE | businessman canonical, Daniel-approved (bdf6d98) |
| `visual-kit/_staging/` | WIP | 12 fig-*.png + 20 plate PNGs staged (gitignored); quarantine + unused patch files also here |
| `…/scratchpad/tranche-a-{spec,genlog,notes}.{json,md}` | DONE | derivation, per-gen record (efe82d2) |
| Task list (session e9c6492e) | WIP | #4 in_progress (taste-pick gate), #5–#8, #10 pending |
| Artifacts | LIVE | plates board f5397657-…; qt-wiles board 6d77773b-… (superseded) |

### Exact Next Step

Get Daniel's one-liner on the plates board (8 picks + retries + cap ≈$7), then dispatch the
composite leg: fresh codex worker (model `codex`/terra), spec-driven from `tranche-a-spec.json`,
4-min/one-reissue rule, picked plates renamed/marked per the image-generation skill's plate-pick
flow before composites seed them. Codex worker sessions (follow-up ids): gen thread
`019fb6ae-12b1-7a70-8c70-6b7f07dffe13` (drifting — prefer fresh), plates worker
`019fb72f-a485-7032-bd53-f93596e7148f`, remint worker `019fb685-49e0-73b3-b3f6-006690142c0f`.

### Load list

- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/tranche-a-notes.md`
- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/tranche-a-genlog.md`
- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/wave-plan.md` (§5 phases, §6 risks)
- `git log --oneline 6735796..efe82d2` on `claude/boss-post-103`
- Memory: `artifact-boards-lightbox.md`, `image-gen-stall-policy.md` (both new this session)
- Skill: `dispatch-codex` (all subagents = codex, Daniel's directive)
