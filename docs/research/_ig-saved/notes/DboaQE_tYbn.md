# DboaQE_tYbn — oh-my-cli - autonomous local code agent (Qwen)
- post: https://www.instagram.com/p/DboaQE_tYbn/ | author: @Wassim Younes | published: 20260804 | duration: 30s

## What's demonstrated
Talking-head creator (same presenter as DaTZxm-J5mZ) narrating over a screen-recorded scroll through a GitHub README for a project called "oh-my-cli", then cutting to a screenshot of a Qwen announcement post (X/Twitter-style) and an LMArena-style leaderboard chart. Pitch: a free, local, open-source autonomous coding agent CLI built on Qwen Code / Qwen3.8-Max that needs no Anthropic/OpenAI API billing.

## Dashboard / UI-UX observed
Not a product dashboard — this is a GitHub README scroll plus embedded social post screenshots:

1. **oh-my-cli GitHub README** (0:00-0:04): dark-mode GitHub repo page, header shows repo name "oh-my-cli" with a description line "A small code-agent CLI with file and shell tools. Built with..." (cut off), then an "H2: What is oh-my-cli?" section. Bulleted feature list visible in README text (partially obscured by overlay boxes): "Safety is the product" with a "spoof-resistant" + "folder-trust boundary" + workspace scoping + "deterministic comm..." + "tools fail closed by default"; "Durable sessions" mentioning JSONL session logs, "compact", "export".

2. **Qwen announcement screenshot** (0:05-0:22): a dark-background text post (looks like a pasted/screenshotted announcement, not a live app UI) reading "Next week, the open weights of Qwen3.8-Max will be released, and Qwen3.8-27B is also going open-weights..." followed by a bulleted spec list: "Autonomous coding: 10+ days of self-evolving development, from empty folder to production without hand-holding, complete project trace in the GitHub: github.com/qwen-code-dev-...", "Re[al work, real results]: Production-quality deliverables across hundreds of professions", "Long-horizon mastery... autonomous planning with clos[ed-loop]... driving 500+ turns of chip design and 365 days of e-commerce s[imulation]", "Native multimodal in[put]... it's a continuous [loop] for planning, execution, [and verification]", and a pricing line: "Pricing: Input: $2.0 / M tokens, Output: $6.0 / M tokens, Implicit..." (cut off).

3. **LMArena-style benchmark leaderboard** (0:23-0:28): a horizontal bar chart titled "Vis[ion]... Qw[en]..." (source cut off, likely arena.ai leaderboard per the footer text "SOURCE: ARENA AI LEADERBOARD (ARENA.AI/LEADER...)"). Ranked list of 20 models with green horizontal bars and numeric Arena scores, in descending order: 1. Claude Fable 5 (High) — 1,318; 2. Qwen3.8-Max — 1,305 (highlighted with a yellow outline box); 3. Claude Opus 4.7 (Thinking) — 1,303; 4. Claude Opus 4.6 (Thinking) — 1,299; 5. Claude Opus 4.7 — 1,298; 6. Claude Opus 5 (High) — 1,295; 7. Muse Spark — 1,294; 8. Claude Opus 4.6 — 1,294; 9. Gemini-3.6 Flash — 1,290; 10. Gemini-3 Pro; 11. GPT-5.5; 12. Claude Opus 4.8 (Thinking); 13. Gemini-3.5 Flash (Medium); 14. GPT-5.5 (High); 15. Muse Spark 1.1; 16. Grok-4.5; 17. GPT-5.4 (High); 18. GPT-5.6 Sol (xHigh); 19. GPT-5.4; 20. Claude Opus 4.8. Each row has a small provider-icon (Anthropic asterisk, Google "G", OpenAI-style icon, infinity symbol for "Muse Spark", X-logo for Grok).

## Concrete mechanism
oh-my-cli is presented as an open-source CLI wrapper/harness around the Qwen Code model family that runs fully locally, executing an autonomous plan→implement→verify→evidence loop with file/shell tool access, session persistence (JSONL), and default-closed ("fail closed") tool permissions plus a "folder-trust boundary" for scoping.

## Named tools / repos / models / APIs
- "oh-my-cli" — the open-source code-agent CLI itself [frame, GitHub README + caption]
- "Qwen Code" / "Qwen3.8-Max" / "Qwen3.8-27B" — the underlying model family oh-my-cli is built on [frame, both README and Qwen announcement screenshot; also audio]
- github.com/qwen-code-dev-... (URL cut off/truncated on screen, not fully legible) [frame]
- "Claude Fable 5", "Claude Opus 4.6/4.7/4.8", "Gemini-3/3.5/3.6", "GPT-5.4/5.5/5.6 Sol", "Grok-4.5", "Muse Spark/1.1" — comparison models on the Arena leaderboard chart [frame]
- Arena AI Leaderboard (arena.ai) — cited as the chart's data source [frame, footer text]

## Specific claim / result
- "Qwen3.8 Max beats Fable 5 from many of its benchmarks" [audio, 0:12-0:16] — directly contradicted by the leaderboard frame itself, which shows Claude Fable 5 (High) ranked #1 at 1,318 and Qwen3.8-Max ranked #2 at 1,305, i.e. Qwen3.8-Max does NOT beat Fable 5 on the chart shown on screen. This is a factual misstatement by the narrator relative to their own visual evidence.
- "10+ days of self-evolving development, from empty folder to production without hand-holding" [frame, Qwen announcement text]
- "500+ turns of chip design and 365 days of e-commerce s[imulation]" [frame, Qwen announcement text] — specific but unverifiable/context-free benchmark claims
- Pricing: Input $2.0/M tokens, Output $6.0/M tokens [frame] — this actually contradicts the video's own "no API fees" framing, since Qwen3.8-Max itself is metered per-token; "no API fees" applies only to open-weight local self-hosting, not to using the hosted Qwen3.8-Max endpoint shown in the pricing screenshot.
- "No API fees, no vendor lock-in" [frame, text overlay, 0:13-0:16]
- "Task → Plan → Implement → Verify → Evidence" [frame, text overlay, 0:17-0:20] — the workflow loop oh-my-cli claims to run

## Novel / buildable moments (with timestamps)
- 0:00-0:04: README feature bullets naming concrete governance primitives worth studying/replicating for any local agent harness: "spoof-resistant" auth, "folder-trust boundary", workspace scoping, deterministic tool-calling with "fail closed by default", durable JSONL sessions with compact/export.
- 0:23-0:28: the Arena leaderboard chart itself is a clean, reusable dashboard reference — ranked horizontal bar chart with provider icons, numeric scores, and a highlighted/outlined row to call out a specific model.

## Transcript highlights
"Qwen 3.8 just released their fully autonomous AI agents that work fully on your PC. You no longer need to pay Enthropic or Open AI for AI agents." [audio, 0:00-0:08]
"Qwen 3.8 Max beats Fable 5 from many of its benchmarks." [audio, 0:12-0:16] — see claim-vs-evidence contradiction above.
"It does work, gives its own checkpoints, and continues." [audio, 0:23-0:26]

## Reliability
Substantive relative to the other three reels: the README screenshot is a real (if partially obscured) product page with specific, checkable governance/architecture claims (folder-trust boundary, fail-closed tools, JSONL sessions), and the Qwen announcement + Arena leaderboard are legible, named, sourced artifacts rather than generic B-roll. However, the central spoken claim ("beats Fable 5") is directly contradicted by the leaderboard shown in the same video, which is a reliability red flag for the narrator's framing even though the underlying artifacts (repo, model announcement, leaderboard) appear genuine. The leaderboard chart UI itself is the most concretely useful visual asset in this reel.
