# figment — AI persona influencer pipeline

Disclosed AI creator personas (disclosure copy is Daniel's, carried as a bible field).
Pipeline goal: persona → assets → content → post → metrics → strategy, on lifted
tooling wherever it exists. Two north stars: (1) non-AI look — consistency, anti-gloss,
human cadence/variation; (2) growth → engagement → link clicks → revenue.

Phase now: research, testing, skills, connectors. Agents wrap the stages later.
Constraints: per-wave spend approval (estimate on the card first); Daniel holds all
account credentials/tokens (pipeline sees them only as provisioned env, never in repo);
lift-first — build nothing a maintained repo/SaaS/MCP already does; keep files lean.

## Layout

```
personas/<id>/   bible.md · assets/ · content/<batch>/ · metrics/ · strategy/
research/        W0 reports, bake-off scores, decision boards
pipeline/        runnable stages + connectors (each standalone, agent-wrappable)
skills/          written only once a stage stabilizes
```

## Persona bible (schema sketch)

identity (name, age 23–27, origin) · face spec + multi-angle reference sheet ·
body spec + motion notes · voice (caption grammar) · world (recurring sets, wardrobe —
set continuity is the #1 AI tell) · archetype + content mix (per-persona data: e.g.
bedroom-thirst-only vs lifestyle-variety vs mixed; format %, cadence, axis position) ·
funnel (domain, per-door slug, terminal) · disclosure (Daniel's copy).

## Pipeline stages

persona-forge · asset-base (refs + LoRA + consistency gate) · batch-gen · qa-gate
(adversarial: identity consistency + AI-tell checklist, three-state stamp) · pack-post
(official APIs only; unofficial private-API automation is a named Daniel-level risk
decision, not a default) · metrics-pull (PLAYS/LIKES labeled, slug clicks, funnel subs,
revenue; audience AI-suspicion logged as signal) · strategy-report (metrics → next batch).

## Waves and gates

- W0 research: R1 stills stacks (SaaS + ComfyUI/Flux/SDXL + LoRA methods) ·
  R2 video gen (API + open i2v) · R3 posting/metrics automation (Postiz, Graph API,
  Insights) · R4 operator landscape (who runs AI influencers, with what stacks).
  Then bake-off: same test set (multi-angle sheet, 10-image held pose, window-light
  pan reel, motion clip, next-day regen stability) through shortlisted stacks.
  GATE: stack pick + spend approval. Also verify kb VM GPU/VRAM before LoRA plans.
- W1 persona-A bible (night-shift room archetype per board v4). GATE: bible approval.
- W2 asset base + LoRA + consistency test. GATE: eye-gate.
- W3 first 14-day batch + adversarial QA. GATE: batch approval.
- W4 pack-post to private test account + metrics-pull wired. GATE: real-account go-live
  (Daniel: account creation, disclosure, tokens).
- W5 first strategy report from real metrics. GATE: review → scope the agents phase.

Every wave ends with an adversarial review by a separate agent before its gate.
Reference research: Persona Inspiration Board v4 (artifact 7f30f554), board §11
directions A–E, §12 risk rules (no birth years, no school framing, stated age 23–27).
