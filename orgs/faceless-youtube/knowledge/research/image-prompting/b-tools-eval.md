# B-Sweep: Open-Source Tools, Repos, Plugins, Evaluation Harnesses

Research task for the faceless-youtube image pipeline: gemini-3-pro-image + reference PNGs,
deterministic regex lint, LLM shot-list critic, verify-and-retry review loop. API-only —
no local diffusion runtime (no ComfyUI/SD). This doc filters every finding through that constraint.

Status: DONE.

---

## 1. Prompt-optimization tools/repos

### Promptist (Microsoft)
- URL: https://github.com/microsoft/LMOps/tree/main/promptist (paper: NeurIPS 2023 Spotlight, arXiv 2212.09611)
- What it does: GPT-2-sized model fine-tuned (SFT then RL) to rephrase a short user prompt into a Stable-Diffusion-preferred prompt — mostly appends aesthetic/quality modifier tokens ("intricate detail, sharp focus, trending on artstation, 4k...") learned to maximize a reward combining CLIP-similarity-to-original-intent and an aesthetic-score model.
- Evidence: beats manual prompt engineering on automatic metrics + human preference, RL stage helps most on out-of-domain prompts.
- Transfers to us? NO as a tool (SD1.x-era model, trained for old SD aesthetics, wrong domain — we want flat cel-shaded cartoon, not "trending on artstation" maximalism). The RL-against-a-reward-model *idea* doesn't transfer either since we can't run RL loops against gemini-3-pro-image cheaply. Historical/negative signal: confirms generic "beautify" prompt rewriting is orthogonal to our need (adherence, not aesthetics).

### NeuroPrompts
- URL: paper only, no clear standalone GitHub found (Intel Labs / Bar-Ilan, EACL 2024 demo) — https://intellabs.github.io/multimodal_cognitive_ai/neuro_prompts/
- What it does: constrained decoding with a prompt-engineer-style LM + user-controllable style constraints (grammar-guided, so output stays as a valid "prompt-engineer-flavored" sentence obeying user-picked style tags).
- Evidence: demo-only paper, no large benchmark numbers surfaced.
- Transfers to us? NO (SD-era aesthetic-maximizing tool, same failure mode as Promptist — not adherence-focused).

### PromptEnhancer (Tencent Hunyuan)
- URL: https://github.com/Hunyuan-PromptEnhancer/PromptEnhancer (CVPR 2026, arXiv 2509.04545)
- What it does: trains a CoT prompt-rewriter via RL against **AlignEvaluator**, a reward model built on a **24-key-point taxonomy** of T2I failure modes across 6 super-categories:
  - Linguistic Comprehension: Negation, Attribute Consistency (one attribute → multiple objects), Pronoun Resolution
  - Visual Attributes: Counting (n≥3), Size/relative-scale, Material/texture, Expression, Artistic Style
  - Action & Interaction: Full-body Action, Hand Action, Animal Action, Contact Interaction, Interaction w/o Contact, State
  - Relations & Structure: Comparative Relation, Compositional Relation, Containment Relation, Similarity Relation, Cross-Entity Binding, Entity Layout
  - World Knowledge & Reasoning: Knowledge Application (named/famous entities), Counterfactual (surreal/impossible scenes)
  - Scene Text & Typography: Text Rendering (accurate text content), Text Layout (positioned as instructed)
- Evidence: +5.1% average accuracy across all 24 dims on HunyuanImage 2.1; biggest single gains: Similarity Relation +17.3%, Counterfactual +17.2%, Counting +15.0%, Pronoun Resolution +13.9%.
- Transfers to us? The TRAINED REWRITER model doesn't transfer (wrong base model, needs RL infra we don't have). **The 24-point taxonomy is directly reusable as a checklist** — it's effectively a more granular, battle-tested version of what our lint + critic should be checking for. Several categories (Counting n≥3, Text Rendering/Layout, Cross-Entity Binding, Hand Action) map onto known failure modes in flat cel-shaded illustration generation. **rule-to-encode candidate.**

### VisualPrompter
- URL: https://github.com/teheperinko541/VisualPrompter (ICLR 2026, arXiv 2506.23138) — repo appears to be a placeholder/thin at time of check, judge on the paper.
- What it does: training-free (no fine-tuning) closed-loop prompt refiner. Two modules: **SERE** (self-reflection) — a VLM inspects the generated image and identifies which atomic semantic concepts from the prompt are *missing or wrong*; **TSPO** (target-specific prompt optimization) — an LLM then expands/rewrites **only the concepts that failed**, leaving everything else in the prompt untouched, emulating human CoT-style targeted revision. Uses **Davidsonian Scene Graph (DSG)** itself as the internal alignment metric to decide what's missing.
- Evidence: ICLR 2026 accepted; reports 4-9 point absolute gains in semantic alignment over baseline prompting/rewriting approaches on standard T2I alignment benchmarks.
- Transfers to us? **YES — highest-value prompt-optimization finding in this sweep.** This is a technique, not a tool: (1) decompose the shot prompt into atomic checkable facts, (2) have a VLM (Gemini/Claude reading the generated image) answer yes/no per fact, (3) on retry, rewrite ONLY the failing clauses rather than regenerating the whole prompt from scratch. Our verify-retry loop currently (per task context) has an LLM read the image and presumably decides pass/fail/retry holistically — this argues for making the retry step **surgical** (targeted patch to the failing shot elements) instead of a full re-prompt, which should reduce prompt drift across retries. **technique-to-reimplement candidate.**

### DALL-E-3-style prompt upsampling (DSPy implementation)
- URL: https://github.com/soumik12345/diffusion_prompt_upsampling
- What it does: reimplements the DALL-E-3 tech-report's "prompt upsampling" idea (LLM expands a short/vague user prompt into a long, detailed, unambiguous prompt before generation) using DSPy + Weave for tracking/optimization.
- Evidence: no independent benchmark; it's an engineering reproduction of OpenAI's documented technique, not a new result.
- Transfers to us? Partially — we already do "prompt upsampling" implicitly (our writer authors 40-190 *structured* prompts, richer than DALL-E-3's approach). The useful residual idea: DSPy's pattern of treating the rewrite step as an optimizable *signature* with logged input/output pairs is a good harness pattern IF we ever want to systematically A/B our prompt-writer's phrasing choices — not urgent now, filed as low-priority technique.

---

## 2. Image-adherence evaluation harnesses

This is the core of the sweep. All of the following decompose "does the image match the prompt" into checkable sub-claims, which is exactly the shape of a smarter verify-retry gate.

### TIFA
- URL: https://github.com/Yushi-Hu/tifa (ICCV 2023, arXiv 2303.11897) — 186 stars, Apache-2.0, last meaningful update Apr 2024 (maintenance-mode, not dead-dead but not active).
- Mechanism: an LLM (GPT-3.5-turbo, or open fine-tuned LLaMA-2 for a fully open pipeline) generates a set of question-answer pairs per prompt (across 12 categories: object, counting, color, activity, spatial, etc.), filters them for validity with UnifiedQA, then scores an image by having a VQA model answer each question and checking against the expected answer. Score = fraction of questions answered correctly.
- Evidence: TIFA v1.0 benchmark (4K prompts / 25K questions) shows notably better correlation with human judgment than CLIPScore-style metrics.
- Repo health: usable but stale-ish; supports classic VQA models (mplug, blip, git, ofa) that are dated (2022-2023 vintage) and clearly weaker than gemini-3 or Claude reading the image directly.
- Transfers to us? **YES as a TECHNIQUE, NOT as a repo.** Don't install this — the "generate N yes/no/short-answer questions from the prompt, then answer each independently against the image" pattern is directly re-implementable as a single multimodal LLM call (or two calls: one to generate questions from the shot prompt text, one to answer them against the rendered image). This is strictly stronger evidence than a single holistic "does this look right?" critic verdict, and it produces a structured, loggable per-question pass/fail — useful for both retry-targeting (see VisualPrompter above) and for building a track record of which failure categories recur.

### Davidsonian Scene Graph (DSG)
- URL: https://github.com/j-min/DSG (ICLR 2024, arXiv 2310.18235) — 109 stars, last activity Mar 2024 (dormant but complete/functional — a finished research artifact, not abandoned mid-build).
- Mechanism: improves on TIFA's question generation reliability. Three LLM-prompted steps: (1) decompose the prompt into **atomic, unique semantic tuples** ("skill-specific" — entity, attribute, relation, etc.), (2) build a **dependency graph** among tuples (e.g., "is the motorcycle blue?" depends on "is there a motorcycle?"), (3) convert tuples to natural-language questions. Scoring zeroes out child-question credit when a parent question fails, which prevents nonsensical partial credit (e.g., crediting "the motorcycle is blue" as correct when there's no motorcycle at all).
- Evidence: shown to be more reliable (fewer hallucinated/duplicated/omitted questions) than TIFA's flatter QG approach; DSG-1k benchmark (1,060 prompts) is the standard follow-on eval set cited by later papers (VisualPrompter uses DSG as its internal metric, see above).
- Repo health confirmed by direct read: pipeline is fully modular prompting — verified reimplementable with just LLM API calls, no proprietary DSG-specific code required. Original demo used GPT-3.5-turbo/PaLM-2 for QG and mPLUG/InstructBLIP/PaLI/GPT-4o for VQA, but the architecture is model-agnostic.
- Transfers to us? **YES — the strongest single technique in this sweep, and it directly upgrades TIFA's idea.** Recommended shape for us: (1) one LLM call turns a shot's structured prompt into a small dependency-ordered checklist of atomic facts (character present? correct pose? correct prop? correct color? correct camera framing? on-model per style bible?), (2) one multimodal LLM call (Gemini or Claude reading the rendered still) answers each checklist item in order, short-circuiting children when a parent fails, (3) the verify-retry loop uses this structured output instead of (or alongside) its current holistic judgment. **technique-to-reimplement candidate — highest priority.**

### VQAScore / CLIP-FlanT5 / t2v_metrics
- URL: https://github.com/linzhiqiu/t2v_metrics (paper: ECCV 2024, arXiv 2404.01291); project page https://linzhiqiu.github.io/papers/vqascore/ — 598 stars, Apache-2.0, actively maintained (v3.1 as of mid-2026, quarterly model refreshes), 2M+ HF downloads.
- Mechanism: single-question approach, simpler than TIFA/DSG — ask a VLM "Does this figure show {full prompt text}?" and use the model's own token-probability of "Yes" as a continuous alignment score (geometric mean over the sequence). No question decomposition; no separate QA-pair generation step.
- Evidence: state-of-the-art correlation with human judgment among "cheap" (single-model, single-question) metrics at publication; outperforms CLIPScore without needing GPT-4/proprietary reward models.
- Repo health / deployment: pip-installable (`pip install t2v-metrics`), supports fully-API-only operation via GPT-4o or **Gemini 2.5 (Vertex AI)** as the scoring backend, in addition to open-weight VLMs (Qwen2.5/3-VL, PaliGemma, Gemma 3) for local/offline use.
- Transfers to us? **YES, and this one is closest to tool-to-adopt rather than pure technique** — because it already has a maintained, API-only code path built specifically for Gemini as backend. Caveat: it wants Vertex AI (not the plain Gemini API key we'd use for gemini-3-pro-image), so plumbing would need adapting; and it collapses everything into ONE holistic score (no per-element breakdown), which is strictly less diagnostic than DSG's checklist. Best use: as a fast **coarse pre-filter score** (cheap single-call sanity check) ahead of a full DSG-style checklist pass for shots that fail the coarse threshold — not a replacement for structured verification.

### GenEval
- URL: https://github.com/djghosh13/geneval (NeurIPS 2023, arXiv 2310.11513) — 472 stars, MIT, 14 commits (small, stable, "done" repo).
- Mechanism: NOT VQA-based — uses classical object detection (Mask2Former via MMDetection) plus auxiliary discriminative vision models to check object co-occurrence, count, position, and color against the prompt's structured spec. Strong human agreement for its narrow scope (object presence/count/color/position); explicitly weaker on spatial relations and attribute binding.
- Repo health / feasibility: requires local `mmdet` (MMDetection 2.x) install, conda env, and downloading Mask2Former weights via a script — **NOT API-only**, needs a real GPU/local inference stack.
- Transfers to us? **NO as a tool** (violates the API-only / no-local-model constraint outright — this is exactly the kind of local CV stack we can't run). The underlying CHECKS it performs (object count correct? right color assigned to right object? right relative position?) are exactly the kind of atomic facts a DSG-style checklist should include — so the *category list* is worth mining, but the *implementation* is a hard no.

### T2I-CompBench / T2I-CompBench++
- URL: https://github.com/Karine-Huang/T2I-CompBench (NeurIPS 2023 + TPAMI 2025, arXiv 2307.06350) — active, well-cited benchmark suite.
- Mechanism: 6,000-8,000 prompt benchmark across attribute binding (color/shape/texture), object relationships (spatial/non-spatial), generative numeracy, and complex compositions; scored via a mix of BLIP-VQA, UniDet (detection), and CLIP-based sub-metrics per category, plus a GORS reward-model fine-tuning recipe.
- Transfers to us? **NO as a tool** (same local-model-stack problem as GenEval — BLIP-VQA/UniDet need local weights and a real eval harness, not a fit for API-only). **Mildly useful as a category taxonomy**: attribute binding, spatial vs. non-spatial relations, and numeracy are recurring, well-validated failure buckets worth having explicit checklist items for (overlaps heavily with DSG/PromptEnhancer's taxonomy, so treat as confirming signal rather than a new source).

### LLMScore
- URL: paper only, arXiv 2305.11116 (no widely-referenced maintained repo found).
- Mechanism: converts an image into image-level AND object-level text descriptions (via a captioner + region captions), then feeds prompt + descriptions to an LLM which outputs a score + written rationale (multi-granularity — global scene fit and object-level fit are scored separately).
- Evidence: Kendall's tau correlation with human judgment 58.8% higher than CLIP and 31.2% higher than BLIP-based baselines (2023-era numbers; modern VLM-as-judge would likely do even better since captioning has improved a lot).
- Transfers to us? Technique overlaps with what a strong multimodal critic already does implicitly (look at the image, compare to intent, explain why). The useful residual idea is the explicit **two-granularity split (whole-scene fit vs. per-object fit)** as a structuring device for critic prompts — cheap to add, no new infra. **rule-to-encode candidate (minor).**

### X-IQE
- URL: paper only, arXiv 2305.10843 (MiniGPT-4 based, 2023 vintage — outdated backbone).
- Mechanism: hierarchical Chain-of-Thought evaluation across three axes — fidelity (is it a "real" plausible image), alignment (text-image match), aesthetics — using a VLM to produce structured, self-consistent text explanations rather than a bare score.
- Transfers to us? The three-axis split (fidelity / alignment / aesthetics) is a reasonable rubric skeleton, but our verify-retry critic likely already covers this implicitly. Filed as confirming prior art for "make the critic explain itself in structured axes," not a new mechanism. Low priority.

---

## 3. Storyboard / multi-shot consistency pipelines

### "3 Sprints" AI comic generator (blog writeup, not a maintained repo)
- URL: https://dev.to/reghunaath/we-built-an-ai-comic-generator-in-3-sprints-heres-what-actually-worked-ccj
- What they built and what worked (their words, qualitative only — no quantitative consistency metric reported):
  1. **Character reference sheet as a first-class artifact**: generate ONE image containing every named character from multiple angles with consistent design BEFORE generating any panels — described as "the visual contract for the entire comic." This is functionally identical to what our pipeline already does with character-sheet reference PNGs.
  2. **Multimodal continuity conditioning**: each panel-generation call is given THREE inputs — the character reference sheet, the immediately-preceding panel image, and the structured text prompt. Adding the previous panel as a reference image (not just text continuity) reportedly "reduced jarring scene breaks" beyond what the reference sheet alone fixed.
  3. **Rigid prompt template per panel**: `[Subject & Action] + [Spatial Placement] + [Camera Angle] + [Lighting] + [Key Details]` — a fixed slot order enforced per shot, e.g. "ARIA-7 crouches over a cracked canvas on the factory floor, positioned left-of-centre, low-angle shot from knee height, harsh fluorescent light casting long shadows, paint-splattered hands trembling with uncertainty."
  4. **Canonical character description registry**: characters get a mandatory 3-4 sentence canonical description (age, ethnicity, build, face shape, hair, eyes, distinctive features, clothing) that's presumably injected into every panel prompt referencing that character, rather than re-described ad hoc per shot.
- Transfers to us? **Items 1 and 4 we already do** (character sheets + presumably a style bible/registry). **Item 2 (chaining the immediately-previous shot's rendered image as an additional reference input, not just the character sheet) is the one concrete gap worth checking** — if our current image-generation step only conditions on character-sheet/pose/environment refs and NOT on the previous shot in sequence, adding "previous rendered still" as an extra reference image for shots that continue the same scene/moment could reduce visual drift between adjacent shots. **technique-to-reimplement candidate** (cheap to test: only needs passing one more reference image on scene-continuous shots).
- Item 3 (rigid slot-ordered prompt template) — worth comparing against our own prompt-writer's structure; if not already this disciplined, a fixed slot grammar is a trivial lint-encodable rule. **rule-to-encode candidate (minor, verify against current writer output first).**

### StoryDiffusion
- URL: https://github.com/HVision-NKU/StoryDiffusion (NeurIPS 2024 Spotlight, arXiv 2405.01434)
- What it does: "Consistent Self-Attention" — a modified self-attention mechanism inserted into the SD1.5/SDXL UNet that shares attention across the batch of images being generated for a story, so characters stay visually consistent without any reference image, plus a motion predictor for turning stills into video.
- Transfers to us? **NO, hard no.** This modifies diffusion model internals (attention layers) — categorically requires a local SD/SDXL runtime we don't have and can't get (API-only constraint, no ComfyUI/SD). Confirms by contrast that reference-image conditioning (which the comic-generator writeup and our own pipeline both use) is the correct API-compatible substitute for what StoryDiffusion achieves via architecture surgery. No further action — filed as a "why we don't chase this" data point.

### Generic comic-pipeline repos (AbdelrahmanMostafa12/comic_book_project, AhmedMorsy01/AI-Comic-Book-SDXL, Friday202/ComicGenerator)
- These are small, single-author, SDXL/local-diffusion-dependent hobby projects. Skimmed via search only (not individually deep-dived — low marginal value given they all restate the same reference-sheet + seed-locking pattern already covered above, and all require local SD). Not worth further spend; noted for completeness.

---

## 4. Claude Code plugins / MCP servers for image-gen prompting/review

### mcp-image (shinpr)
- URL: https://github.com/shinpr/mcp-image — 143 stars, MIT, 346 commits, actively maintained.
- What it does: MCP server wrapping Gemini (Nano Banana), OpenAI GPT Image, and BytePlus Seedream behind one interface. Its "automatic prompt optimization" step uses a **Subject-Context-Style framework**: a cheap fast model (Gemini 2.5 Flash / gpt-4o-mini) enriches a minimal user prompt with missing photographic/artistic detail (lighting, composition, atmosphere) — e.g. "cat on a roof" becomes a fully art-directed prompt — while leaving already-detailed prompts "largely intact" (has a detection step to skip enrichment when not needed).
- Transfers to us? Low direct value — we already author far more structured, detailed prompts (40-190 per video, explicit style-bible-driven) than this tool's target use case (casual one-off "cat on a roof" prompts). The **"detect whether enrichment is needed before rewriting" gate** is a mildly useful pattern (avoid double-enriching an already-thorough prompt) but not worth new infra given our writer already front-loads detail. Filed, no action.

### claude-image-gen (guinacio)
- URL: https://github.com/guinacio/claude-image-gen — 48 stars, small/early-stage.
- What it does: Claude Code Skill + optional MCP mode for Gemini image generation. Notable pattern: ships as a **Skill (markdown instructions + bundled CLI script)** rather than a raw MCP tool, deliberately using abstract naming (`media-pipeline`/`create_asset`) so Claude reaches for the Skill layer instead of calling the MCP tool directly — a skill-authoring pattern, not an image-quality technique. No iterative refinement or post-generation review logic; single-pass generation only.
- Transfers to us? Not a capability gap — we already have a full skill-based pipeline (image-generation skill, shot-board, verify-retry) that's more sophisticated than this. No action; filed for completeness only.

### General MCP landscape
- Searched broadly (ImagineArt MCP, Pixa MCP, generic "Image MCP Server" listings). These are consumer-grade single-shot generation wrappers (mostly for Nano Banana/GPT-Image/Seedream) aimed at ad-hoc Claude Desktop/Code image requests, not systematic pipeline production. None found with a genuine question-decomposition verification loop, DSG/TIFA-style scoring, or multi-shot consistency management built in — the eval-harness side of this sweep (section 2) is academic-only; nobody has shipped a maintained MCP server wrapping TIFA/DSG/VQAScore as a Claude-callable verification tool. **This is itself a finding: there's no off-the-shelf MCP to adopt for structured verification — building the DSG-style checklist into our own critic step is the only path, which matches the technique-to-reimplement recommendation in section 2.**

---

## Ranked top-10 candidate integrations/learnings

1. **[technique-to-reimplement] DSG-style checklist verification** — replace (or augment) the current holistic "does this image look right?" critic pass with: (a) one LLM call decomposes each shot's prompt into a small dependency-ordered checklist of atomic, checkable facts (character present + correct pose + correct prop + correct color + correct framing + on-style), (b) one multimodal call (Gemini/Claude reading the rendered still) answers each item in order, short-circuiting children when a parent fails. Source: Davidsonian Scene Graph (github.com/j-min/DSG). Highest-priority item in this sweep — directly upgrades the existing verify-retry loop from a single verdict to a structured, loggable, diagnosable pass/fail per element.

2. **[technique-to-reimplement] Surgical (targeted) retries instead of full re-prompts** — when the checklist above fails specific items, rewrite ONLY the failing clauses of the shot prompt and regenerate, rather than re-issuing a fresh holistic prompt. Source: VisualPrompter's SERE+TSPO split (arXiv 2506.23138), which reports 4-9 point absolute alignment gains from this alone. Reduces prompt drift across retry generations.

3. **[rule-to-encode] 24-point T2I failure taxonomy as a lint/critic checklist** — encode PromptEnhancer's/AlignEvaluator's 24 categories (negation, attribute consistency, pronoun resolution, counting n≥3, size/scale, material, expression, style adherence, full-body/hand/animal action, contact/non-contact interaction, comparative/compositional/containment/similarity relations, cross-entity binding, entity layout, named-entity knowledge, counterfactual scenes, text rendering, text layout) into the deterministic lint and/or the fresh-eyes critic's rubric. Source: arXiv 2509.04545, Table 1. Several categories (counting, text rendering/layout, hand action, cross-entity binding) are known hard failure modes for cel-shaded generation and are currently unvalidated as explicit checks.

4. **[technique-to-reimplement] Chain previous-shot still as an extra reference image on scene-continuous shots** — for shots that continue the same scene/moment, pass the immediately-preceding rendered still as an additional reference PNG alongside the character sheet, not just text continuity. Source: "3 Sprints" comic-generator writeup (dev.to/reghunaath) — reported (qualitatively) to reduce jarring scene-to-scene visual breaks beyond what the character-sheet reference alone fixes. Cheap to test since it only adds one more reference image on a subset of shots.

5. **[tool-to-adopt, narrow use] VQAScore/t2v_metrics as a cheap coarse pre-filter** — github.com/linzhiqiu/t2v_metrics is maintained, pip-installable, and supports Gemini/GPT-4o API-only scoring via a single "Does this image show {prompt}?" probability query. Use as a fast triage score to flag likely-bad generations before spending a full structured DSG-checklist pass on every shot. Caveat: wants Vertex AI plumbing (not a bare Gemini API key) and gives one holistic number, not a diagnostic breakdown — supplement, don't replace, item 1.

6. **[rule-to-encode] Two-granularity critic structure: whole-scene fit vs. per-object fit** — have the verify step (or its prompt) explicitly separate "does the overall scene/composition match" from "does each named object/character individually match its spec," rather than one blended judgment. Source: LLMScore (arXiv 2305.11116). Cheap, no new infra, catches the common failure where the scene reads right at a glance but a specific character/prop is wrong.

7. **[rule-to-encode] Fixed slot-ordered prompt template per shot** — `[Subject & Action] + [Spatial Placement] + [Camera Angle] + [Lighting] + [Key Details]` as a mandatory clause order, lint-checkable. Source: "3 Sprints" comic-generator writeup. Action: first verify whether our visual-prompt-writer's shots.json entries already enforce an equivalent structure before building new lint rules — likely partial overlap.

8. **[rule-to-encode] Mandatory canonical character description registry (3-4 sentences: age/build/face/hair/eyes/distinctive features/clothing)** injected verbatim into every shot referencing that character, rather than re-described ad hoc. Source: "3 Sprints" writeup. Action: verify our style-bible/registry.json already does this before treating as a gap — likely already covered, listed for completeness/audit.

9. **[technique-to-reimplement, low priority] Three-axis critic rubric: fidelity / alignment / aesthetics** — structure the fresh-eyes critic's explanation along these three named axes for clearer, more consistent write-ups. Source: X-IQE (arXiv 2305.10843). Low priority — likely already implicit in current critic behavior; only worth doing if critic outputs are currently unstructured prose.

10. **[confirming signal, no action] GenEval / T2I-CompBench category taxonomies (object count, color-binding, spatial vs. non-spatial relations, generative numeracy) corroborate the DSG/PromptEnhancer checklist categories** — both tools are themselves NOT adoptable (require local Mask2Former/MMDetection/BLIP-VQA/UniDet stacks, violating the API-only constraint), but their well-validated category lists cross-check items 1 and 3 above. Use only as a taxonomy sanity check when building the checklist, not as a tool or dependency.

**Explicitly rejected (documented so nobody re-investigates them):** Promptist and NeuroPrompts (SD-era aesthetic-maximizer rewriters, wrong domain and no local-training path); StoryDiffusion (requires diffusion-model attention-layer surgery, hard-blocked by API-only constraint); GenEval and T2I-CompBench as installable tools (local CV/detector stacks, hard-blocked); mcp-image and claude-image-gen (capability we already exceed, no gap to fill); generic hobby comic-pipeline repos (SDXL-dependent, redundant with the one writeup already mined).
