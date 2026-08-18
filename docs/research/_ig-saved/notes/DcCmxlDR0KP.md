# DcCmxlDR0KP — Local AI hardware getting capable
- post: https://www.instagram.com/p/DcCmxlDR0KP/ | author: @Ty's AI's | published: 20260815 | duration: 54s

## What's demonstrated
A creator shows off his home "AI stack" running fully local, self-hosted LLMs on physical hardware, then narrates through model-release tweets/benchmarks and finally shows a custom multi-provider coding-agent UI ("Hermes Agent") that lets him route between local and frontier models from one client. Framed as a personal hardware/software setup tour, not a tutorial.

## Dashboard / UI-UX observed
Two distinct UI elements are worth capturing:

**1. Hermes Agent — multi-provider model router UI** [0:50-0:53]: a coding-agent app on a blue-themed screen, large wordmark "HERMES AGENT" with tagline "Search the repo, edit files, run tests, open PRs. Tell me the goal and I'll handle the mechanics" — i.e. positioned as a Claude-Code-style repo agent. A "Search models" dropdown is open, grouped by provider/org into labeled sections:
  - ALLSPARK: SuperDeepseek V4 Flash Abliterated...
  - ARAGORN: Qwen38 27b Unsloth Nvfp4 (High)
  - NOUS PORTAL: Fable 5, Opus 5, Opus 4.8, Sonnet 5, Haiku 4.5, GPT-5.6-sol, GPT-5.6-sol-pro, GPT-5.6-terra, GPT-5.6-terra-pro, GPT-5.6-luna, Gemini 3.1 pro — each tagged with an effort level (High)
  - MoA presets: "MoA: default" (mixture-of-agents preset)
  A right-side "OPTIONS" panel offers a "Thinking" toggle and an "EFFORT" selector with 7 levels: Minimal / Low / Medium / High / Extra High / Max / Ultra. This is a directly buildable UI pattern: local self-hosted models and frontier API models sit in the *same* provider-grouped picker with a shared per-model effort/thinking control, rather than separate tools for local vs. cloud.

**2. Physical hardware + repo-card overlays** [0:02-0:12]: shows a stack of 3 small gray box devices (NVIDIA DGX Spark-class mini compute units) on a desk, then a HuggingFace-style repo-card overlay reading "Jiunsong/SuperDeepseek-V4-Flash-abliterated-MQ-2xDGX" (with a copy-button icon, matching HF's actual card chrome) confirming the model repo name and that it runs across 2 of the 3 stacked units. A handheld thermal-camera device (worn as a smartwatch form factor) is pointed at the stack, showing live thermal readouts (Cen/Max/Min in °F) climbing across frames — visualizing the hardware running hot under load. A second repo-card overlay, "unsloth/Qwen3.8-27B-NVFP4" (with like count 122, "Follow Unsloth AI 31k"), appears while pointing the thermal camera at a separate tower PC.

**3. Screenshotted release/benchmark content** [0:13-0:24, 0:42-0:45]: a Qwen official X/Twitter post announcing Qwen3.8-27B open weights (native multimodal dense model, 262K context extendable to 1M via YaRN, Apache 2.0 license, plus a larger "Max-level" Qwen3.8-2.4T-A95B); a "Run Qwen3.8 27B locally" quantization chart from a site branded "Atomic Chat — Local AI Models" plotting Mean KL Divergence vs. File Size (GB) across quant levels (AD-IQ2_XS through Q8_0) with a comparison table (Memory/Quant/Size/Top-1/Mean KL Div); an SGLang benchmark tweet reporting "206.1 tok/s decode on a single RTX 5090 with NVFP4+DSpark, 38.28 tok/s decode on DGX Spark" for Qwen3.8-27B; and a benchmark table comparing Qwen3.8-27B / Qwen3.6-27B / Qwen3.7-Plus / Muse Glimmer-30B / Opus4.6 Max across Terminal-Bench 2.1, SWE-bench Pro, H2Repo-Bench, DeepSWE 1.1, SWE-bench, CollieBench, JobsBench, AgentLastExam, IFBench, GPQA Diamond, HLE, LiveCodeBench.

## Concrete mechanism
Runs two quantized open-weight models locally across stacked DGX Spark-class devices: DeepSeek V4 Flash (0731, "abliterated"/uncensored fine-tune by user "Jiunsong") split across 2 devices at ~100 tok/s, and Qwen3.8-27B (NVFP4 quant by Unsloth) on a third device at ~30 tok/s. Both claimed to have 1M-token context. Inference engine debate: creator prefers vLLM over SGLang, notes no DGX Spark-optimized build of Qwen3.8 exists yet in vLLM. Uses a custom multi-provider agent client (Hermes Agent) that groups local and cloud models under one model picker with shared effort/thinking controls, running "as a mixture of agents or individually."

## Named tools / repos / models / APIs
- DeepSeek V4 Flash (0731 build) — [audio, "running Deepseek V4 Flash 0731"], repo `Jiunsong/SuperDeepseek-V4-Flash-abliterated-MQ-2xDGX` [frame]
- Qwen3.8 (27B dense, and 2.4T-A95B "Max-level" MoE variant) — [audio + frame], repo `unsloth/Qwen3.8-27B-NVFP4` [frame], official announcement from @Alibaba_Qwen [frame]
- NVIDIA DGX Spark — hardware referenced by name multiple times [audio: "these sparks that you see here", "dSpark option"; frame: repo name references "2xDGX", benchmark table references "DGX Spark"]
- SGLang (`@sgl_project`) and vLLM (`@vllm_project`) — inference engines, both shown as X profile cards [frame + audio]
- Unsloth AI — quantization/fine-tuning shop, named via repo owner and "Atomic Chat — Local AI Models" quantization comparison chart [frame]
- Hermes Agent — the creator's custom coding-agent client [frame, 0:50-0:53]
- Claude models referenced in the model picker: Opus 5, Opus 4.8, Sonnet 5, Haiku 4.5 [frame] — plus GPT-5.6 variants and Gemini 3.1 pro [frame]

## Specific claim / result
"Deepseek is getting around 100 tokens per second, and then the Qwen is at 30." [audio, 0:09-0:13] — a first-person, on-screen-unverified performance claim (no tokens/sec counter is actually visible in the DGX Spark frames, only a thermal readout). "I'm extremely impressed with Deepseek because I don't even use Claude or Codex anymore at home... the benchmarks say they're on Opus level, but they feel and perform just on the same level as Opus now" [audio, 0:27-0:47] is immediately self-qualified on-screen by a text overlay: "Not on Opus 5 level* — Even though Opus 5 has been garbage lately" [frame, 0:46-0:47] — i.e. the creator's own caption contradicts/walks back the spoken claim.

## Novel / buildable moments (with timestamps)
- [0:50-0:53] Provider-grouped model picker (ALLSPARK/ARAGORN/NOUS PORTAL org groupings mixing self-hosted quantized models with frontier API models) plus a shared effort-level control (Minimal→Ultra) across all providers — directly relevant prior art if kb ever wants a unified model-router UI spanning local + cloud inference.
- [0:15-0:16] The "Atomic Chat" quantization trade-off chart (KL divergence vs. file size, with a clear best-fit line and per-quant-level table) is a reusable chart pattern for documenting our own model/quantization choices if kb ever runs local models.

## Transcript highlights
- "Right now I'm running Deepseek V4 Flash 0731 across two of these sparks that you see here, and then the one on top is running Quinn 3.8." [0:01-0:09]
- "I don't like running SG Lang, I like VLLM more. And there's not a dSpark option for Quinn 3.8 yet, but when there is in VLLM, I will run it." [0:15-0:26]
- "My entire home stack is now Hermes Agent, Super Deepseek, and Quinn 3.8. And both of the models have a million context." [0:32-0:40]
- On-screen caveat overlay: "Not on Opus 5 level* — Even though Opus 5 has been garbage lately" [0:46-0:47]

## Reliability
More substantive than a typical lead-magnet reel — real hardware is shown, real repo names/cards are captured (verifiable on HuggingFace/X if those handles exist), and the creator self-corrects an overstated claim via on-screen text. No install/setup instructions or CTA link is offered, so it's pure show-and-tell, not a pitch. The Hermes Agent model-picker UI is the one visual worth reusing directly; the hardware/benchmark content is informational rather than a UI/UX reference.
