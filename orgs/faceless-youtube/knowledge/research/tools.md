# Research — tool mapping

Maps each pipeline stage to a tool, per the "Claude unless it genuinely cannot compete" rule. Pricing
and full stack detail live in `stack.md`; this file is the *why-this-tool* reasoning and the menu of
alternatives (mostly drawn from the AI Frontier Directory + Faceless Pipeline Build Report).

## Stage → tool

| Stage | Owner | Tool(s) | Why |
| --- | --- | --- | --- |
| Niche, idea, title, script, metadata, visual prompts, compliance, analytics | **Claude** | Claude Code skills | Pure language/judgment; no tool competes. $0 marginal. |
| Voice | External | **ElevenLabs** (default) | Claude can't synthesize speech. OSS fallback: GPT-SoVITS, F5-TTS. |
| Stills / graphics | External | **Nano Banana 2** (Google — stills/infographics, 2026 standard), Midjourney (aesthetic), Ideogram (text-in-image), Recraft (vector/brand) | Called via fal.ai / Replicate for API access. |
| Motion / animation | External | **Kling 3.0** (2026 default — cinematic clips up to ~3 min), Luma, Veo 3.1 | Affordable text/image-to-video, camera control. **Note: Sora was discontinued April 2026** — do not plan around it. |
| Talking clips (if ever) | External | Hedra | Photo + audio → talking character. Only if a face is the format. |
| Render / assemble | Local | **Remotion** (the only engine) | Self-hosted React motion engine; `render-builder` derives a `motion.json` and renders locally — $0 marginal, no watermark, no per-minute meter. JSON2Video (cloud) was the original pick but was **removed 2026-07-10**. |

## Visual generation — where it connects

Visuals touch the pipeline in two places: **prompt-writing** (`visual-prompt-writer` — pure Claude,
writes `shots.json`) and **pixel generation** (`image-generation` — external, paid). The `image-generation`
skill produces the verified, on-style stills into `assets/scenes/`, and the local **Remotion** engine
(`render-builder`) assembles them into the MP4 — generation and assembly are cleanly separated skills,
so swapping either doesn't touch the other. The retired JSON2Video path used to bundle image-gen +
assembly in one cloud call; that's gone (removed 2026-07-10). For niches that need real motion B-roll
beyond stills, an optional `visual-generator` skill (Kling/Veo clips + stock) can feed `assets/clips/`
without changing the assembler — build it only if the still pipeline misses the quality bar.
| Transcription (mining sources) | Local | whisper.cpp / WhisperX | Local, fast, free. Word timestamps for subtitles. |
| Publish | External | **YouTube Data API v3** | The leg no guru demos; build from scratch. Free, audit-gated. |
| Analytics | External | YouTube Analytics API + Google Sheet | Free reads; Sheet from day one. |
| Orchestration glue (if needed) | Local | Claude Code scheduled tasks (native); n8n / Trigger.dev / Windmill as fallback | Native scheduling likely covers it. |
| Validation all-in-one (throwaway) | External | AITuber MCP (has Claude MCP server); AutoShorts (API) | Week-one validator only; cancel after graduating. |

## Notes

- Everything external sits behind a file-based skill → swap providers without touching the rest of the
  pipeline.
- Repos worth knowing if we ever self-host media: ComfyUI (image pipelines), GPT-SoVITS/F5-TTS (voice
  clone), whisper.cpp (transcription), ACE-Step (music). See the AI Frontier Directory.
