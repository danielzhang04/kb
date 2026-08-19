# DRAFT — Open-weight and lower-cost worker models

_Research snapshot: 2026-08-19. Prices and rankings change quickly; verify before procurement._

## Bottom line

Do not replace Claude or Codex as orchestrators. Pilot two additional worker lanes:

1. **DeepSeek V4 Flash** for cheap, bounded, machine-verifiable text/code grunt work.
2. **GLM-5.2** for harder open-weight agentic coding where DeepSeek Flash fails.

Before adding either, benchmark **GPT-5.6 Luna** as the control. It is not open-weight, but its
current API price ($0.20/M input, $1.20/M output) is lower than most hosted open-weight frontier
models, and OpenAI says the July price cut also reduced its credit consumption in Codex. Since the
existing subscription already includes it, Luna may be the best economic grunt worker without any
new provider or integration.

Keep Claude/Codex on task definition, routing, judgment, security-sensitive work, and final review.
Only give cheaper workers tasks with objective acceptance checks.

## Shortlist

| Model | Best fleet role | Capability/effectiveness | Current list price per 1M tokens (input/output) | Material caveat |
|---|---|---|---:|---|
| **GPT-5.6 Luna** (closed) | Control; high-volume routine implementation, extraction, classification | OpenAI's fast/high-volume tier; tools and multi-step workflows; already available in Codex | **$0.20 / $1.20** | Not open-weight; subscription quotas are not equivalent to API billing |
| **DeepSeek V4 Flash** | Cheapest hosted open-weight lane; mechanical edits, tests, transforms | 1M context; thinking toggle; JSON, tool calls, Responses API, and OpenAI/Anthropic-compatible endpoints | **$0.22 / $0.66 off-peak; $0.44 / $1.32 peak** | Independent testing found extremely high “answer anyway” behavior when uncertain; use only behind deterministic verification |
| **MiniMax M3** | Fast multimodal worker; screenshot/document/video analysis and routine coding | Native multimodal, thinking toggle, up to 1M context; independent measurement reported ~95 tok/s | **$0.30 / $1.20** for <=512K input under current discount | Community license has attribution/notice and large-company authorization conditions; not clean MIT/Apache openness |
| **GLM-5.2** | Higher-quality open-weight coding/terminal worker | MIT; 1M context; flexible effort. Artificial Analysis measured 51 on its Intelligence Index and 78% on Terminal-Bench v2.1 | **$1.40 / $4.40** | More verbose/token-hungry than peers; 744B/40B-active and ~1.5 TB full weights make first-party API more practical than local hosting |
| **DeepSeek V4 Pro** | Alternative hard-task worker | 1M context and the same agent/API features as Flash; stronger than Flash | **$0.66 / $1.98 off-peak; $1.32 / $3.96 peak** | Very high token use and high hallucination behavior reduce the apparent per-token advantage |
| **Kimi K2.6** | Multimodal long-running coding specialist | Thinking toggle; image/video; tools, JSON, cache; 256K context | **$0.95 / $4.00** | Good model, but presently dominated on price by M3 and on open coding value by GLM/DeepSeek |
| **Kimi K3** | Frontier multimodal knowledge work, not grunt work | Open weights; 2.8T/104B-active; 1M context; strong long-horizon and visual work | **$3 / $15** (cache-miss input/output) | Too expensive and too large to be the first worker pilot; this is a specialist/near-frontier lane |
| **gpt-oss-20b** (local) | Private/offline transformations, summaries, first-pass tests | Apache 2.0; configurable reasoning, tool use, OpenAI-compatible local serving; fits in ~16 GB memory | Hardware/electricity | Much weaker than current hosted frontier; only economical if hardware already exists or utilization/privacy justifies operations |
| **Qwen3.5-35B-A3B** (local) | More capable local multimodal/agent candidate | Apache 2.0; 35B total/3B active; 262K native context; vendor reports 69.2 SWE-bench Verified and strong tool/agent results | Hardware/electricity | Full-context serving is operationally heavier; assess only after a hardware inventory and a quantized local bake-off |

“Open source” is used loosely in the market. The more accurate umbrella term is **open-weight**.
GLM-5.2, Qwen3.5, and gpt-oss have permissive MIT/Apache licenses; MiniMax M3 and Kimi K3 use
custom licenses with conditions.

## Illustrative cost per worker run

For a deliberately large run using **100K uncached input + 20K output tokens**, before tool/search
fees and excluding subscription economics:

| Model | Approx. cost |
|---|---:|
| DeepSeek V4 Flash, off-peak | $0.035 |
| GPT-5.6 Luna | $0.044 |
| MiniMax M3 (<=512K tier, current discount) | $0.054 |
| DeepSeek V4 Flash, peak | $0.070 |
| DeepSeek V4 Pro, off-peak | $0.106 |
| Kimi K2.6 | $0.175 |
| DeepSeek V4 Pro, peak | $0.211 |
| GLM-5.2 | $0.228 |
| Claude Sonnet 5 API | $0.400 |
| GPT-5.6 Terra API | $0.440 |
| Kimi K3 | $0.600 |

Per-token price is not cost per successful task. Reasoning models may emit radically different token
counts; a cheap failure plus an expensive retry can cost more than routing correctly the first time.

## Recommended pilot

Run a 30-card bake-off using past kb tasks with known outcomes:

- 10 mechanical code changes with deterministic tests
- 10 extraction/classification/report transformations with schemas
- 5 repository investigations with evidence requirements
- 5 deliberately ambiguous or failure-prone tasks

Test **Luna vs DeepSeek V4 Flash vs GLM-5.2** on identical work orders and harness settings. Add
MiniMax M3 only if multimodal worker demand is real. Measure:

- acceptance rate on first attempt
- total cost per accepted task (including retries and reviewer cost)
- tool-call/schema validity
- wall-clock time
- unnecessary file churn / scope violations
- hallucinated claims and unsupported evidence
- escalation rate to Claude/Codex

Routing rule for an initial rollout:

- **Luna:** default low-cost lane while subscription capacity is available.
- **DeepSeek Flash:** bounded, reversible, non-sensitive tasks with tests/schema checks.
- **GLM-5.2:** harder coding/terminal work that still has objective verification.
- **Claude/Codex:** orchestration, ambiguous judgment, security, architecture, final inspection, or any
  task that fails one cheap-worker attempt.

Pin model versions and providers. Open-weight endpoint accuracy can vary because hosts quantize,
change kernels, or misconfigure serving; cheapest-provider routing can silently reduce quality.
Never send credentials or sensitive repository content to a new provider. Local hosting should be a
separate decision driven by privacy or sustained utilization, not by the word “open.”

## Sources

- [OpenAI: GPT-5.6 Luna/Terra price reduction](https://openai.com/index/advancing-the-price-performance-frontier-with-gpt-5-6/)
- [OpenAI Docs: current GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [DeepSeek: models, features, context, and current peak/off-peak pricing](https://api-docs.deepseek.com/quick_start/pricing/)
- [Z.AI: GLM API pricing](https://docs.z.ai/guides/overview/pricing)
- [GLM-5.2 model card](https://huggingface.co/zai-org/GLM-5.2)
- [MiniMax M3 product/model page](https://www.minimax.io/models/text/m3)
- [MiniMax M3 API and Token Plan pricing](https://platform.minimax.io/subscribe/token-plan)
- [Kimi K2.6 pricing](https://platform.kimi.ai/docs/pricing/chat-k26)
- [Kimi API pricing overview](https://www.kimi.com/help/kimi-api/api-pricing)
- [Kimi K3 model card](https://huggingface.co/moonshotai/Kimi-K3)
- [gpt-oss-20b model card](https://huggingface.co/openai/gpt-oss-20b)
- [Qwen3.5-35B-A3B model card](https://huggingface.co/Qwen/Qwen3.5-35B-A3B)
- [Artificial Analysis: open-weight model comparison](https://artificialanalysis.ai/models/open-source)
- [Artificial Analysis: endpoint accuracy differs by host](https://artificialanalysis.ai/articles/endpoint-accuracy-index)
- [Anthropic: current Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)
