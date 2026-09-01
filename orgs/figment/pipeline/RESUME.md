# figment — resume point (2026-08-31, before session restart)

Branch `claude/figment`. Restart was to load the `creator-studio` MCP server.

## State

**Research: complete.** r1–r9 + w0-decision-board v3 + trial-protocol v2 +
reuse-from-fyt + daniel-provisioning, all committed under `orgs/figment/`.

**Local stack: built and proven.** `C:\Users\danie\tools\ComfyUI` — own venv,
torch 2.11.0+cu128, CUDA live on the RTX 4070 (8 GB), RealVisXL_V5.0_fp16 installed.
1024px @ ~21s/image warm (~37s sustained), 27% VRAM headroom. Start with:
`venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188` from the ComfyUI dir.

**Arm A progress** (`personas/trial-01/`, untracked — synthetic test character):
- `brief.md` — character invariants + prompt fragments.
- `candidates/` — 30 independent SDXL generations. **Finding: realism excellent
  (skin texture, natural light, no gloss); identity NOT reliably consistent without
  conditioning** — face gestalt and hair held, but the mole anchor migrated/vanished,
  "full body" collapsed to bust framing, "profile" came out three-quarter.
- `refs/` — 20 curated from those candidates + NOTES.md. Usable as a first LoRA set for
  face/hair; thin on body proportion and true profile.
- `anchor.png` — canonical identity anchor picked for the conditioning pass.
- **ComfyUI_IPAdapter_plus installed** with clip_vision + 2 ipadapter models. The agent
  chose IP-Adapter over PuLID — verify WHY at resume, specifically whether it avoided
  InsightFace's non-commercial licence (that was the instruction). Licence position is
  still UNCONFIRMED and matters: this project is commercial.

## Next step (interrupted mid-flight)

Generate the identity-locked reference set: using `anchor.png` as IP-Adapter
conditioning, produce ~20 images of the SAME face across angles/lighting/distances
(clothed casual only), write them to a NEW dir (do not overwrite `refs/`), then compare
against the anchor and report honestly how well identity holds. That answers whether
our own build can lock a persona — the question the whole trial turns on.

## Blocked on Daniel

- `creator-studio` MCP (Eromify) — added at user scope, needs restart; auth method
  unknown (OAuth prompt vs 401-wants-a-token will reveal it).
- Civitai account + Buzz (arm B). Test 0: IG professional account + Meta token.
  Fanvue written confirmation. See `daniel-provisioning.md`.

## Do not repeat

- `npx eromify-mcp` — **the package does not exist on npm** (404; zero results for
  "eromify" registry-wide). Their docs' CLI installer is unpublished — a
  dependency-confusion shape. Use the MCP URL directly, never that command.
- Their setup docs coach users to rename the connector to evade AI safety systems. We
  named it `creator-studio` for Daniel's own discretion, not for that reason.
