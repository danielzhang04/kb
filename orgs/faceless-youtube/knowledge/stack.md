# Tool stack, APIs, costs

The rule: **Claude does all language work for $0 marginal;** pay external tools only for what Claude
genuinely cannot do (voice, visuals, render, upload). Every external call is behind a file-based skill
so the provider is swappable.

## What Claude owns (never pay a SaaS for these)

Niche/sellability logic, idea + title research, full scripts, metadata, visual/shot-list prompts,
compliance reasoning, repurposing, analytics interpretation. (The "script SaaS" gurus sell is just
Claude Sonnet with a hook wrapper.)

## External slots

| Slot | Default tool | Price/mo | Notes / alternatives |
| --- | --- | --- | --- |
| Brain + orchestration + all language skills | Claude Code (existing Max plan) | $0 marginal | — |
| Validation all-in-one (throwaway) | AITuber MCP (~$29) | $29–49 | Has an MCP server → drives from Claude. Alt: AutoShorts API. Cancel after validation. |
| Voice (TTS) | ElevenLabs | $6–22 | Starter $6 / Creator $22. OSS fallback: GPT-SoVITS, F5-TTS. |
| Render / assemble | **Remotion (local)** | $0 marginal | Self-hosted React motion engine — `render-builder`'s `build_motion.py` derives a `motion.json` and `engine/` renders it locally (~1.5× realtime, no API, no watermark, no per-minute meter; free license ≤3 people). The **only render engine.** JSON2Video (cloud, ~$50 Pro) was the original choice after a 2026-07-01 sweep but was **removed 2026-07-10** — the local engine holds the locked visual style, costs nothing, and has no watermark/length caps. Rejected in the original sweep: Shotstack, Creatomate. |
| Image / illustration | **Recraft** (connected 2026-07-03) — flat-vector house style + **true editable SVG**, custom **style-lock** (`style_id` from ref frames). **Nano Banana / Gemini image** (connected 2026-07-03, image gen pending billing) — scenes + character consistency + legible on-screen labels. **The Second Take uses Nano Banana `gemini-3-pro-image` for ALL image gen (2026-07-09 — flash removed; it rendered off-recipe soft-gradient + mangled text; see decisions).** | pro **$0.134/img** (1K or 2K tier; verified 2026-07-31 from [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)), $0.24 (4K) · Recraft $0.04–0.08 · **~$15–30 per full 8–15 min video all-pro** (~120–180 gen calls w/ retries; Batch API halves it for scaled runs) | Chosen after a 4-agent depth-search (2026-07-03): Recraft is the only vector-native generator + purpose-built for flat-vector cartoon; Nano Banana = best zero-training consistency. Replaces the old JSON2Video inline image-gen for this channel (its images were the banned "uncanny middle"). **Recurring-character lock (if we commit a mascot):** one-time Flux LoRA (fal/Replicate, ~$2–6) or Ideogram/Leonardo char-ref. **License note:** Flux `[dev]` is non-commercial — for monetization use Recraft / Flux `schnell`/`klein` / a paid license. **Ruled out:** Midjourney (no API), Playground (no API); DALL-E 3 removed, Imagen 4 deprecated. Full survey → `research/tools.md`. |
| Publish | YouTube Data API v3 | free | Capped + audit-gated (see playbook). |
| Analytics | YouTube Analytics API + Google Sheet | free | Sheet from day one; real dashboard only when it stops scaling. |

## Cost envelope

- **Validation phase:** ~$29–49/mo, then cancelled.
- **Steady-state, one voiceover-led niche:** ~$55–90/mo, toward ~$110 only for heavy generated visuals
  or an avatar.
- No hard budget cap set — but prefer the cheapest tool that clears the quality bar. **Log actual
  spend here as it accrues.**
- Rendering is now $0 marginal (local Remotion), so early cost scales with total TTS characters +
  image-gen calls, not channel count; young channels share one ElevenLabs tier at the slow cadence.

## Secrets

Live in `.env` (git-ignored). Template: `.env.example`. This file only names *which* keys exist, never
their values.

## Spend log

| Date | Item | $/mo | Notes |
| --- | --- | --- | --- |
| 2026-07-01 | ElevenLabs (Free) | $0 | TTS provider connected. Free tier = plumbing/exploration only (10k chars/mo, **no commercial license**, attribution required). Key wired in `.env` as `ELEVENLABS_API_KEY`; scopes: TTS Access, Voices/Models/History/User Read, everything else No Access. Sanity-tested (HTTP 200, MP3 returned). **Upgrade trigger:** first real video for a real channel → target Creator $22 (100k chars/mo, ~13 long-form/mo). |
| 2026-07-01 | JSON2Video (Free) | $0 | **RETIRED 2026-07-10 — removed as the render engine** (replaced by the local Remotion engine; never upgraded past Free, so $0 spent). Was connected after a market sweep as the cloud render/assemble provider; Free tier = ~600 render-seconds, used only for building/testing `render-builder`. Key was wired in `.env` as `JSON2VIDEO_API_KEY`. |
| 2026-07-03 | Recraft (API) | prepaid | Illustration engine connected + **quality-validated** — 4 flat-vector cartoon test images (character/scene/banker/piggy) generated on-vibe in one prompt each. Key in `.env` as `RECRAFT_API_KEY`. Balance ~4,880 units (~$4.88 ≈ 120 raster imgs). **Gotcha:** the API sits behind Cloudflare — requests need a browser `User-Agent` header or they 403 (error 1010); default Python `urllib`/curl UA is blocked. Raster $0.04 / vector-SVG $0.08 per img. Next: mint a custom `style_id` to lock the look. |
| 2026-07-03 | Gemini / Nano Banana | free tier | Key authenticates (`GEMINI_API_KEY`); has access to `gemini-3-pro-image` (NB Pro), `gemini-3.1-flash-image` (NB2), etc. **Image gen blocked on free tier** (429, `generate_content_free_tier_requests limit: 0`) — needs **billing enabled** on the key's Google Cloud project. Not a blocker (Recraft covers us); enable when scene/character-consistency gen is needed. |
