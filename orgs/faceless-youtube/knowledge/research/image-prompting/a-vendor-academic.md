# Image-prompting research: vendor + academic sweep

Context: our pipeline has visual-prompt-writer author ~40-190 structured still prompts/video (~600-1500 chars scene CONTENT), a fixed style suffix is appended, and `gemini-3-pro-image` renders each still SEEDED with reference PNGs. Pain points: long prompts (rig boilerplate ~1,100 chars eating half the prompt on some shots), text-rendering fidelity, cross-shot character/scene consistency, model rendering instruction language as diegetic text (control-leak).

Legend: **[VENDOR]** = vendor-documented, **[MEASURED]** = has an experiment/benchmark behind it, **[FOLKLORE]** = community consensus, unverified.

---

## Source 1 — Google Developers Blog: "How to prompt Gemini 2.5 Flash Image Generation for the best results"
URL: https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/
**[VENDOR]**

- Core principle: **"Describe the scene, don't just list keywords."** Narrative, descriptive paragraphs outperform disconnected keyword lists — attributed to the model's language-understanding core (this is a Gemini-native image model, not a pure diffusion model conditioned on CLIP-style tags).
- Specificity is explicitly rewarded: "Instead of 'fantasy armor,' describe it: 'ornate elven plate armor, etched with silver leaf patterns...'" — i.e. push adjectives down into concrete nouns/materials rather than stacking modifiers.
- No stated hard prompt-length limit or "sweet spot" in this doc — but it flags that "achieving perfection on the first attempt with highly nuanced requests can require iteration," implicitly conceding complex/long asks degrade single-shot fidelity.
- Text-in-image: state the exact text (imperative to be literal/verbatim), describe font style, describe overall design intent. Template: "Create a [image type] for [brand/concept] with the text '[text to render]' in a [font style]." Complex typography still "sometimes needs refinement."
- Character drift across iterative edits is acknowledged as a real failure mode; the vendor's own fix is **not** a prompting trick but a workflow reset: "if you notice a character's features begin to drift after many iterative edits, restart a new conversation with a detailed description to retain consistency." (Implies: don't chain edits indefinitely; drift compounds per turn.)
- Multi-image input: aspect ratio is inherited from the **last** image supplied when multiple reference images with different ratios are given — a concrete ordering effect on references, not just text.
- Negative prompts: recommends semantic positive framing over exclusion — "an empty, deserted street with no signs of traffic" instead of "no cars." No support implied for a dedicated negative-prompt channel (unlike classic diffusion CFG negative prompts).
- Composition control via photographic/cinematic vocabulary: "wide-angle shot," "macro shot," "low-angle perspective," "85mm portrait lens," "Dutch angle" are treated as reliable, precise levers.

**Transfers to us?** High. (a) Our style suffix is already a "describe the scene narratively" complement — fine. (b) The character-drift finding validates a suspicion: if we ever chain edits on one seed instead of re-invoking with full reference composite, we should expect drift; we should keep re-seeding with the canonical reference PNGs every shot rather than iteratively editing forward. (c) The "positive framing only, no real negative prompt" finding is important — if our style suffix or shot prompts contain "no X" phrasing, this vendor doc says restate positively. (d) Last-image-wins aspect-ratio behavior matters for how we order composited reference PNGs per shot.

---

## Source 2 — Google Cloud Blog: "Ultimate prompting guide for Nano Banana" (Gemini image models incl. Nano Banana Pro / Gemini 3 Pro Image family)
URL: https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana
**[VENDOR]** — this is the most directly relevant vendor doc since it covers the Gemini-3-generation image models (our `gemini-3-pro-image` is in this family).

- Recommended prompt formula for pure text-to-image: **`[Subject] + [Action] + [Location/context] + [Composition] + [Style]`** — style is explicitly last in the vendor's own template, matching our practice of appending a fixed style suffix at the end. This is a concrete, vendor-sourced ordering rule.
- Recommended formula for reference/multimodal generation: **`[Reference images] + [Relationship instruction] + [New scenario]`**. The "relationship instruction" is the key middle term — e.g., "using the attached napkin sketch as the structure and the attached fabric sample as the texture, transform this into..." — i.e. the prompt's job with references present is to state *how each reference should be used*, not to re-describe what's already visible in it.
- Reference image limit: up to 14 reference images per prompt.
- Editing/inpainting guidance: **"Be explicit about what to keep exactly the same."** This is the vendor's direct answer to our "how much should the prompt re-describe what the reference carries" question — the burden is inverted: don't re-describe the reference, instead state constraints on what must NOT change.
- Text rendering: enclose desired text in quotation marks; specify font/typography style by name or description ("bold, white, sans-serif," or a real font name); multilingual support via explicit translate-and-localize instruction.
- **"Text-first hack"**: for tricky/long text, first have a text conversation with the model to nail down the exact text content/wording, THEN ask for the image with that already-agreed text. Splits the linguistic-generation task from the rendering task.
- Style vs. content split is explicit in the vendor's own mental model: **content** = subject/action/objects; **style** = film stock, color grading, lighting setup, camera/lens choice. This maps directly onto our architecture (content = per-shot prompt, style = fixed suffix).
- Composition: aspect ratios supported 1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9 (plus ultra-wide 1:4/4:1/1:8/8:1 on Gemini 3.1 Flash Image Preview).
- Negative prompts: same positive-framing-only guidance as Source 1; no dedicated negative-prompt syntax documented for this model family.
- Context window: Nano Banana 2 = 131,072 input tokens, Nano Banana Pro = 65,536 input tokens; max output tokens 32,768 for both. These are enormous relative to our ~600-1500 char (roughly 150-400 token) content prompts + suffix — **prompt length in the "does it get truncated" sense is a non-issue; the risk is purely attention/adherence dilution, not a hard cutoff.**
- No explicit vendor guidance on multi-character/multi-subject attribute binding beyond "use reference images" — this is a real gap in vendor documentation (see academic sources below for what fills it).

**Transfers to us?** Very high — directly on our model family.
1. Confirms style-suffix-last is the vendor's own recommended order — no change needed there.
2. The reference-image guidance ("state relationship + what to keep the same," don't re-describe) directly answers our "how much should the prompt re-describe what's already in the reference PNG" question: **our rig-boilerplate clause should shrink to a constraint/delta statement** ("keep face/proportions/palette exactly as reference; only X changes") rather than restating the entire character description in prose every shot. This is the single highest-leverage finding for our long-prompt pain point.
3. The text-first hack is directly applicable to our baked diegetic text requirement — consider a two-step or explicitly quote-first construction in the prompt itself.
4. Confirms no real negative-prompt channel exists for this model — if our lint/prompts currently use exclusion language ("no signage," "not visible"), vendor guidance says convert to positive statements, and this may be contributing to control-leak (the model treats "don't render X as text" as content to consider/echo rather than a hard mask).

---

## Source 3 — ai.google.dev: "Prompt design strategies" (Gemini API docs)
URL: https://ai.google.dev/gemini-api/docs/prompting-strategies
**[VENDOR]** — general Gemini prompting doc, not image-specific, but bears directly on our "does ordering matter, does length degrade adherence" questions since our image model is Gemini-native (language-conditioned), not a bolt-on diffusion U-Net.

- **Ordering is explicitly load-bearing, not folklore, per vendor**: "When providing large amounts of context (e.g., documents, code), supply all the context first. Place your specific instructions or questions at the very end of the prompt." — i.e. **recency/end-position is privileged for the operative instruction.**
- "Prioritize critical instructions: place essential behavioral constraints, role definitions (persona), and output format requirements in the System Instruction or at the very beginning of the user prompt." Note the apparent tension with the point above — resolved by role: *global/constant* constraints (persona, format) go at the very start or in system instructions; *content/context* goes in the middle; the *specific ask for this turn* goes at the very end, closest to generation.
- Vendor explicitly says ordering is empirically sensitive and worth testing per-task: "the order of the content in the prompt can sometimes affect the response," recommending A/B'ing [examples][context][input] vs [input][examples][context] orderings.
- No explicit prompt-length ceiling stated in this doc (it defers to Imagen/native-image-gen-specific docs, which we cover in Sources 1-2 and below).
- Transition phrases recommended when bridging long context into the final instruction ("Based on the information above...").

**Transfers to us?** Moderate-high, structural. Maps onto a concrete three-zone template for our shot prompts: **[persistent identity/constraint anchor] → [scene content: layout, action, palette, light, depth] → [specific/most-important instruction: e.g. the exact baked text, or the one changed delta element] at the very end.** Right now if our rig clause sits mid-prompt as one long block, this vendor guidance argues for moving the *single most important, must-not-be-missed* instruction (e.g. exact quoted diegetic text, or the one changed delta) to the last sentence of the prompt, not burying it before 1,100 characters of boilerplate.

---

## Source 4 — ai.google.dev: "Generate images using Imagen" (Gemini API docs)
URL: https://ai.google.dev/gemini-api/docs/imagen
**[VENDOR]** — note: Imagen (the diffusion-model line, distinct from Gemini-native image gen) is being **deprecated in favor of "Nano Banana"/Gemini-native image models by August 17, 2026** per this doc — treat Imagen-specific numbers as informative precedent, not necessarily binding on `gemini-3-pro-image`, but the text-length figures are the only hard vendor numbers found in this sweep.

- **Hard prompt-length ceiling: 480 tokens.** (Imagen-specific; Gemini-native image models have much larger context windows per Source 2, so this ceiling likely doesn't bind our model, but it's the only vendor-stated number for "prompt too long" in this family.)
- **Text-in-image character limit: "Limit text to 25 characters or less for optimal generation."** This is a specific, numeric, vendor-documented sweet spot for baked text length — directly actionable for our "≤4 words" diegetic-text rule (4 words ≈ 20-30 characters, i.e. we are already roughly at the vendor's stated ceiling, not comfortably under it).
- **Multiple text phrases: "experiment with two or three distinct phrases" but avoid exceeding three** for cleaner compositions — i.e. more than ~3 separate baked-text strings per image compounds failure risk.
- Three-part structure recommended: Subject, Context/Background, Style — same triad as Sources 1-2, style consistently placed last.
- English-only prompts (Imagen-specific limitation; may not apply to Gemini-native image models, not verified here).
- No negative-prompt support documented for Imagen either.

**Transfers to us?** Moderate — this is the deprecated model, so treat as **corroborating precedent** rather than the live spec. But the numeric text-length ceiling (25 chars/phrase, ≤3 phrases) is the most concrete, actionable number in the entire vendor sweep, and is more conservative than our current "≤4 words" rule — worth tightening or at least treating our current rule as sitting near the failure boundary rather than safely inside it.

---

## Source 5 — ai.google.dev: "Gemini Generate Content API (Legacy)" image-generation page
URL: https://ai.google.dev/gemini-api/docs/generate-content/image-generation
**[VENDOR]** — this is the live Gemini-native image model doc (our model family).

- No explicit max prompt length or structural template given (in contrast to the deprecated Imagen doc above) — confirms the newer Gemini-native line is documented as more permissive/less formulaic, consistent with "describe narratively" guidance in Sources 1-2.
- **Reference image budgets are asymmetric and role-typed, not a flat pool of 14**: for **Gemini 3 Pro Image** (our model): up to **6 object-reference images** (for high-fidelity object insertion) + up to **5 character-reference images** (for character consistency) — these appear to be separate budgets, not a shared 14-slot pool as the Nano Banana blog post implied generically. This is an important correction/refinement over Source 2's flat "14 images" figure.
- Confirms Gemini 3.1 Flash Image variant has different budgets (10 object + 4 character) — the object/character split is a deliberate, documented architectural distinction, meaning **the model treats "this is a character reference" as a distinct conditioning channel from "this is an object/prop reference."**
- Resolution controls: 512, 1K, 2K, 4K. "Thinking level" (minimal/high) trades quality for latency — a lever with no direct prompt-text analog but relevant to production cost/quality tradeoffs.
- No negative-prompt guidance provided.

**Transfers to us?** High, and actionable: since we composite multiple reference PNGs per shot (character sheets, poses, expressions, environments), we should map each reference PNG to the correct **role** (character vs. object/environment) rather than treating them as an undifferentiated stack — the model's own architecture reserves distinct slots per type, and on `gemini-3-pro-image` specifically we have at most 5 character-reference slots. If a shot needs more than 5 distinct characters clearly identifiable via reference, that shot is architecturally past the vendor's supported ceiling — a hint for why crowd/ensemble shots may be where consistency degrades.

---

## Source 6 — arXiv 2410.00321: "A Cat Is A Cat (Not A Dog!): Unraveling Information Mix-ups in Text-to-Image Encoders through Causal Analysis and Embedding Optimization"
URL: https://arxiv.org/abs/2410.00321
**[MEASURED]** (academic, quantified, training-free technique + new eval metric with 81% human concordance)

- Root mechanism: text encoders used by diffusion pipelines exhibit **causal-attention information bias** — because tokens can only attend to earlier tokens (decoder-style causal masking upstream of the diffusion U-Net), information about objects/attributes gets unevenly distributed across the sequence.
- **Position bias is directional and asymmetric: the FIRST-mentioned subject/object in a prompt is systematically favored** — later-mentioned subjects suffer more attribute loss and misattribution ("mix-ups," i.e. one subject's traits bleeding onto or replacing another's).
- This is presented as a property of the **text encoder**, not the diffusion/attention-map layer per se (contrast with Attend-and-Excite-style cross-attention leakage, which is a separate, also-real mechanism — see Source 7).
- Their fix (embedding balancing) is a backend technique unavailable to us as prompt-writers, but the *diagnostic* is directly usable: >125% measured improvement in "information balance" from correcting this bias confirms the effect is real and large, not marginal.
- Caveat: this paper's target architecture is CLIP/T5-style causal text encoders feeding classic diffusion U-Nets (e.g. Stable Diffusion lineage), not confirmed to describe Gemini's own (likely bidirectional, LLM-native) text conditioning pathway. **Apply with moderate confidence to Gemini image models specifically** — the mechanism (causal LM attention) may or may not be shared, but Gemini's text backbone is itself a decoder-only causal LLM, so the underlying causal-attention argument plausibly transfers even though the paper tested different models.

**Transfers to us?** High relevance as a **hypothesis**, not a proven fact for our exact model — but it is the single most directly actionable academic finding for our #4 pain point (rig-clause bleeding onto named characters): **if our rig-boilerplate clause is positioned BEFORE a shot's named-character-specific description, the boilerplate may be structurally favored by this causal bias, at the expense of the named character's specific traits** — which would explain exactly the leakage/bleeding symptom described in our brief. Concrete, testable prediction: **move the named character's identity/attribute clause to occupy the first-mentioned position in the prompt, and push generic rig/style boilerplate later** — the opposite of whatever our current ordering is if boilerplate currently leads.

---

## Source 7 — Attribute-leakage / multi-subject binding literature survey (multiple papers via search)
Sources: "Object-Attribute Binding in Text-to-Image Generation: Evaluation and Control" (arXiv 2404.13766), "MultiBind: A Benchmark for Attribute Misbinding in Multi-Subject Generation" (arXiv 2603.21937), "When Identities Collapse: A Stress-Test Benchmark for Multi-Subject Personalization" (arXiv 2603.26078), "DreamRenderer" (arXiv 2503.12885), "Leaky Diffusion" (PETS 2025)
**[MEASURED]** (benchmarks with quantified failure rates), synthesized across sources — not a single-source deep read, treat individual numbers as approximate.

- Attribute leakage is a named, well-studied failure class: **"a diffusion model assigns an attribute to an unintended object"** — this is the formal name for exactly our "rig clause bleeding onto named characters" symptom.
- **"When Identities Collapse" (2603.26078) has a directly quantified, alarming finding: multi-subject reference-seeded generation is fine at 2-4 subjects but the "Subject Collapse Rate approaches 100% at 10 subjects."** Root cause named as "semantic shortcuts inherent in global attention routing" — the model takes shortcuts that blend/homogenize distinct identities as subject count rises. This is an "Illusion of Scalability": looks fine in small tests, collapses at scale.
- Complexity of *interaction* (not just count) independently worsens collapse: the benchmark's "Occlusion" and "Interaction" difficulty tiers (vs. "Neutral") show interacting/overlapping subjects fail more than subjects merely co-present.
- Mitigation techniques in the literature (Attend-and-Excite, SynGen, hard attribute binding, masked attribute-aware binding, End-Token-Substitution) are all backend/architecture-level — **none are available to us as prompt-writers on a closed API**, but their existence confirms this is a fundamental model limitation, not something we can fully prompt our way out of.
- The one lever academic literature repeatedly credits at the *prompt* level (not architecture level) is **scene decomposition / reducing simultaneous subject count per generation** — i.e., the practical mitigation available to prompt-writers is to not ask for more distinct, individually-important characters in a single frame than the model can hold (aligning with Source 5's "5 character-reference slots" ceiling).

**Transfers to us?** High for shots with 3+ named characters simultaneously present and interacting (not just co-present) — expect measurably worse consistency/leakage than 1-2 character shots, independent of anything we do in the prompt. This argues for a shot-planning-level rule (visual-prompt-writer's job, not just prompt phrasing): cap simultaneous "must stay visually distinct" named characters per shot, and treat any shot needing more as higher-risk / needing extra review, rather than assuming better prompt wording alone fixes it.

---

## Source 8 — Prompt length vs. adherence: quantitative studies
Sources: "DetailMaster: Can Your Text-to-Image Model Handle Long Prompts?" (arXiv 2505.16915), "Towards Evaluating Robustness of Prompt Adherence in Text to Image Models" (arXiv 2507.08039), general search synthesis (long-prompt degradation studies, ~30% drop over 500 tokens, weak but present correlation coefficient ~-0.07 in one study, five-bin degradation curve <200/200-300/300-400/400-500/>500 tokens)
**[MEASURED]**, mixed strength of effect across studies — flag the effect size disagreement explicitly.

- DetailMaster benchmark (prompts averaging ~285 tokens) identifies four failure categories that specifically degrade under long/detailed prompts: **character attributes, structured character locations (multi-subject spatial placement), multi-dimensional scene attributes, and spatial/interactive relationships.** Two named root causes: (a) text-encoder weakness at "preserving syntactic dependencies" over long spans, (b) **diffusion "saturation" causing attribute leakage specifically "under detail-intensive conditions."** This directly names long/detail-heavy prompts as an independent contributor to attribute leakage — not just multi-subject count (Source 7) but raw prompt density/length by itself.
- Cross-study synthesis (search-aggregated, treat as **[FOLKLORE-leaning-MEASURED]** since I did not verify each underlying paper individually): performance/adherence "degrades sharply on longer prompts, dropping by up to 30% for those over 500 tokens"; models "perform well on prompts under 300 tokens" with degradation increasing in bins beyond that; one correlation-based study found only a weak length↔quality correlation (~-0.07), i.e. **length alone is a weak predictor of quality in isolation — it's likely a proxy for detail-density/complexity, not length per se.**
- "Towards Evaluating Robustness of Prompt Adherence" (2507.08039) — read in full: this paper's own experiment actually isolates **resolution**, not prompt length, as the dominant adherence factor (96% shape-F1 at 1024×1024 vs. <70% at 256×256), and finds **spatial/positional reasoning (quadrant placement) far harder than object/shape recognition** (best F1 only 0.41 for spatial position vs. 90%+ for shape). It also finds **adherence degrades over iterative re-generation cycles** (each successive generate→re-describe→regenerate cycle loses 3-13% shape accuracy, 9-28% spatial accuracy) — relevant if our pipeline ever re-prompts from a previous generation's caption rather than the original shot spec.
- Caveat: this paper deliberately used simple binary/shape test images, not naturalistic scenes — its quantitative numbers may not generalize to our stylized-character-scene domain, but its qualitative ranking (spatial >> shape difficulty; resolution >> most other factors) is a reasonable prior.

**Transfers to us?** Directly relevant to pain point #1. Our ~600-1500 char content prompts (~150-375 tokens by rough char/4 estimate) + ~1100-char rig clause + style suffix likely land prompts in the 300-500+ token range once everything is concatenated — **squarely in the degradation zone multiple studies flag (>300-400 tokens).** The weak isolated length-correlation finding argues the actual driver is *detail density* (how much must be independently gotten right) rather than character count per se — meaning simply compressing the rig clause (Source 2's finding) attacks the real variable, not just a proxy. The resolution finding is a free, orthogonal lever: if our render resolution isn't already at the top tier the model supports, adherence may improve for zero prompt-engineering effort.

---

## Source 9 — Structured vs. prose prompt phrasing
Sources: "Structured Captions Improve Prompt Adherence in Text-to-Image Models" (arXiv 2507.05300, Re-LAION-Caption 19M), general practitioner-consensus search synthesis
**[MEASURED]** for the arXiv paper (training-time caption structuring), **[FOLKLORE]** for the practitioner claims about which models prefer prose vs. keywords.

- The one rigorous finding: enforcing **consistent caption structure at training time** measurably improves text-image alignment/controllability (VQA-scored) vs. noisy/unstructured captions — but this is a **training-data** finding about how the model's own training captions were structured, not directly a claim about how end-user inference-time prompts should be phrased.
- Practitioner-level (unverified, folklore-tier) consensus: modern LLM-native image models (which includes the Gemini/Nano-Banana family, DALL-E 3, Midjourney V6+) were trained on natural-language image descriptions, not comma-separated keyword tags, and **prefer narrative prose over keyword lists** — this directly corroborates the *vendor's own* Source 1/2 guidance ("describe the scene, don't list keywords"), so treat as converging vendor+practitioner-consensus rather than academically proven for this model family specifically.
- One practitioner claim worth flagging as unverified: "a structured prompt produces similar quality across multiple generations, whereas a one-line prompt produces variance" — plausible, consistent with our pipeline's need for repeatable/controllable output across many shots, but **not independently verified here** — mark as folklore.

**Transfers to us?** Confirms (doesn't newly establish) that our existing narrative-paragraph-prompt approach is correctly aligned with vendor guidance and likely training distribution for Gemini image models — no change indicated here. The real lever for us is internal ordering/emphasis within the prose (Sources 3, 6), not prose-vs-structured format.

---

## Source 10 — Text rendering fidelity research (glyph/text-in-image academic literature)
Sources: TextDiffuser-2 (arXiv 2311.16465), GlyphControl (NeurIPS 2023), "Character-Aware Models Improve Visual Text Rendering" (arXiv 2212.10562), STRICT stress-test (arXiv 2505.18985), search synthesis
**[MEASURED]** for the character-length/commonality claims (these are established findings across multiple text-rendering papers, though I did not deep-read each PDF individually — treat as converging-literature rather than single-paper-verified).

- **"Errors in text rendering become increasingly severe as text length grows"** — a monotonic, literature-wide finding, not limited to one architecture.
- **Word-length effect: shorter words (3-5 characters) render more reliably than longer ones.** This is a specific, actionable number that refines the vendor's "≤25 characters total" guidance (Source 4) down to the word level: our "≤4 words" diegetic-text rule should also mind per-word length, not just total phrase length — a 4-word phrase made of long words (e.g. "extraordinary international documentation") is riskier than one made of short words (e.g. "not my dog") even at similar total character count.
- **Frequency/commonality effect: common/training-frequent words render more reliably than rare or invented words.** Directly relevant to our "quoted verbatim" baked-text rule — if the script's diegetic text uses invented terms, brand names, or uncommon vocabulary, expect higher misspelling/garbling risk than for common words, independent of length.
- Character-count distribution in training data for these models clusters at 10-50 characters, with "the majority of samples containing fewer than 150 characters." — reinforces that short text is not just safer but is what the model has actually seen most.
- Architecture-level solutions (glyph-conditioning, character-aware tokenizers) are backend fixes unavailable to us via prompting — but their existence confirms text rendering is a known, actively-researched weak point across the entire model class, not a quirk specific to our pipeline or user error.

**Transfers to us?** High and directly actionable for pain point #2. Two concrete, literature-backed refinements to our "≤4 words, quoted verbatim" rule: (a) prefer common/short words within the 4-word budget when the script allows a choice of phrasing for the same diegetic beat; (b) treat total-length and per-word-length as separate risk dials, both worth minimizing, not just total word/char count.

---

## Source 11 — OpenAI Cookbook: "GPT Image Generation Models Prompting Guide" (cross-vendor comparison point, not Google)
URL: https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide
**[VENDOR]** — OpenAI, not Google, but the only vendor doc found that speaks directly to our pain point #4 (control-leak: instruction language rendering as diegetic text) and to the "explicit exclusion" question. Include as a cross-check on Google's guidance, and flag where the two vendors disagree.

- Direct, actionable guidance for our #4 pain point: **"Put literal text in quotes or ALL CAPS and specify typography details (font style, size, color, placement) as constraints."** The mechanism implied: the model needs a structural/typographic signal (quote marks, caps, explicit "this is the text to render, everything else is instruction") to separate "text to bake in" from "prose describing the scene" — if our prompts state instructions and quoted diegetic text in the same register/voice, that's a plausible cause of the model treating instruction phrasing as content to render.
- **For hard-to-render words: "spell them out letter-by-letter to improve character accuracy."** A concrete, testable mitigation for our text-rendering fidelity pain point (#2) beyond just keeping words short/common (Source 10) — untested by us, cheap to try.
- **Direct contradiction of Google's positive-framing-only guidance**: OpenAI explicitly recommends **negative/exclusion statements**: *"State exclusions and invariants explicitly (e.g., 'no watermark,' 'no extra text,' 'no logos/trademarks')."* This is a genuine cross-vendor disagreement, not a nuance — Google (Sources 1, 2) says never phrase exclusions negatively; OpenAI says explicitly state them, including **"no extra text"** as a named example directly relevant to our control-leak problem. Flag as unresolved rather than picking a side without our own test.
- Reference-image guidance directly answers our "how much to redescribe" question, converging with Google's Nano Banana guidance (Source 2): **"Use references like 'same style as before' or 'the subject' to leverage context, but re-specify critical details if they start to drift."** I.e. default to NOT redescribing, but treat re-specification as a targeted drift-correction tool, not a default per-shot practice.
- For multi-image compositing: **"Reference each input by index and description ('Image 1: product photo… Image 2: style reference…')"** — a concrete technique for disambiguating which reference PNG governs which role in the prompt, complementary to Google's object/character reference-slot typing (Source 5).
- Prompt length stance is notably more permissive than the academic degradation literature (Source 8): **"Long prompts can work well, but debugging is easier when you start with a clean base prompt and refine with small, single-change follow-ups."** Read as workflow advice (iterate incrementally) rather than a claim that length has no fidelity cost — doesn't contradict Source 8's measured degradation, just reframes the practical response to it (iterate rather than write shorter).
- Format-agnostic on structured vs. prose prompts: "Minimal prompts, descriptive paragraphs, JSON-like structures, instruction-style prompts, and tag-based prompts can all work well" — a milder, more permissive claim than Google's narrative-prose-only framing (Sources 1-2), though not a direct contradiction since it doesn't rank them.

**Transfers to us?** High for pain point #4 specifically — this is the only source in the sweep that names our exact symptom (instruction language leaking into rendered text) and gives a mechanism-level fix (typographic/structural signaling of "this is literal text" via quotes/caps + explicit constraint framing). The negative-framing disagreement with Google is worth an actual A/B test on our own shots rather than resolving by vendor authority, since Google is the platform we actually render on but OpenAI's specific claim ("no extra text" as an exclusion) targets exactly our failure mode.

---

## Source 12 — Prompt redundancy / constraint reinforcement (practitioner + HCI literature)
Sources: RunDiffusion "Multi-Image Prompt Guide" (practitioner), "The Cultivated Practices of Text-to-Image Generation" (arXiv 2306.11393, HCI/ethnographic study of practitioner prompting norms)
**[FOLKLORE]** (RunDiffusion) and **[MEASURED-adjacent]** (Cultivated Practices is a qualitative/ethnographic academic study of practitioner behavior, not a controlled quantitative experiment — treat its "findings" as documented consensus practice, not proven causal claims).

- Important **counter-nuance to the "compress the rig clause" recommendation** (Sources 2, 8): "a prompt can be long and still be clean, but the problem is when it's long **and redundant**." I.e. length and redundancy are being treated as two separable variables by practitioners — a long-but-non-redundant prompt (every clause adds distinct information) is claimed to behave differently than a long-and-repetitive one. This nuances Source 8's length-degradation findings: the mechanism may be information-density-per-token more than raw token count, which would mean a compressed rig clause helps not just by being short but specifically by removing restated/redundant information.
- **Reinforcement claim, in tension with "keep it short":** "prompt information can fade as the model processes deeper layers, so if a constraint matters, you should reinforce it by repeating the constraint in **two different ways** rather than spamming the same phrase." This is presented as folklore/practitioner wisdom, not measured — but it's a specific, non-obvious claim: don't repeat verbatim (that's redundancy, penalized above), but do restate an important constraint once more **in different words** if it's critical. Flag as unverified but worth testing cheaply (e.g. on a must-not-drift trait like a signature prop or expression).
- General multi-image workflow practitioner norms: reference each image by role/index, keep edits minimal per pass, avoid stacking multiple changes in one generation call — converges with OpenAI's Source 11 guidance and with our own delta-chain design (one changed element per cut) already being the right instinct architecturally.

**Transfers to us?** Moderate — mostly corroborates and refines rather than introduces new direction. The length-vs-redundancy distinction is the most useful nugget: it suggests our rig clause compression project (Source 2's top recommendation) should target **removing restated information** (the same character trait re-described in prose that a reference PNG already encodes), not merely truncating word count in a way that might cut non-redundant, load-bearing content instead.

---

## Top-10 candidate learnings (ranked, concrete, portable — for prompt-writing logic)

1. **When a reference PNG already carries a trait, state a constraint on it, don't re-describe it.** Replace "re-describe the character in prose" rig clauses with short **keep/change constraint statements** ("identity, proportions, and palette exactly as reference; only [the one delta] changes"). This is the single highest-leverage fix for the ~1,100-char rig-clause bloat — it attacks the actual redundant content, not just word count.
   *Backed by: Source 2 (Google Nano Banana — "be explicit about what to keep exactly the same"), Source 11 (OpenAI — "re-specify critical details if they start to drift," default to non-redescription), Source 12 (redundancy, not raw length, is the flagged culprit).*

2. **Put the single most important instruction — the exact quoted diegetic text, or the one changed delta element — at the very end of the prompt, closest to generation.** Reserve the very beginning for persistent identity/constraint anchors (persona/format-like info); put full scene content in the middle.
   *Backed by: Source 3 (Gemini API prompting-strategies — instructions/questions go at the end; critical constraints/persona go at the very start), converges with Source 2's own template ending in Style.*

3. **Test whether named-character identity should be mentioned BEFORE generic rig/style boilerplate, not after — first-mentioned subjects are structurally favored.** This is a testable hypothesis, not proven for our exact model, but it directly predicts our observed "rig clause bleeds onto named characters" symptom if boilerplate currently leads.
   *Backed by: Source 6 (arXiv 2410.00321 — causal-attention first-mention bias in mix-ups between subjects), moderate confidence transfer (mechanism tested on different architectures, but Gemini's own backbone is also a causal decoder LLM).*

4. **Cap simultaneous "must stay visually distinct" named characters per shot at the model's documented reference budget — 5 character-reference slots on `gemini-3-pro-image`.** Treat any shot needing more distinct characters, or complex physical interaction between characters (not just co-presence), as inherently higher-risk for identity blending — a shot-planning-level cap, not something better wording fixes.
   *Backed by: Source 5 (vendor-documented 5-character-slot ceiling for our exact model), Source 7 (measured near-100% subject-collapse rate at high subject counts; interaction/occlusion independently worsens it).*

5. **Cap baked diegetic text at ≤25 characters per phrase and ≤3 phrases per image; within that budget, prefer short (3-5 char), common words over long or invented ones.** Our current "≤4 words" rule is close to the vendor ceiling, not comfortably under it — a 4-word phrase of long/rare words is riskier than a 4-word phrase of short/common ones at similar total length.
   *Backed by: Source 4 (Imagen vendor doc — 25-char/phrase, ≤3-phrase numeric guidance), Source 10 (literature-wide: shorter and more common words render more reliably).*

6. **Signal "this is literal text to render" structurally (quotes or ALL CAPS + explicit typography constraints), and consider spelling out hard/uncommon words letter-by-letter** — this is the most direct lever against control-leak (instruction language rendering as diegetic text), our pain point #4.
   *Backed by: Source 11 (OpenAI — explicit quote/caps + typography-as-constraint framing, letter-by-letter spelling for hard words), Source 2 (Google — quote the desired text, "text-first" two-step generation for tricky text).*

7. **A/B test explicit negative exclusions ("no extra text," "no watermark," "no logos") against Google's positive-framing-only guidance, specifically for the control-leak problem** — this is a genuine, unresolved vendor disagreement (Google says never phrase negatively; OpenAI explicitly recommends "no extra text" as an exclusion example that targets our exact symptom). Don't resolve by vendor authority; test on our own shots.
   *Backed by: Source 1/Source 2 (Google, positive-framing-only) vs. Source 11 (OpenAI, explicit exclusion recommended, naming "no extra text").*

8. **Treat resolution as a free, orthogonal lever for adherence — verify we're rendering at the model's top supported resolution before assuming prompt wording is the bottleneck.** One controlled study found resolution dominated adherence far more than other tested factors (96% vs. <70% shape-fidelity swing between 1024px and 256px).
   *Backed by: Source 8 ("Towards Evaluating Robustness of Prompt Adherence," 2507.08039 — resolution as dominant factor; caveat: tested on simple shapes, not naturalistic scenes, so treat as a prior, not a guarantee).*

9. **Map every composited reference PNG to a typed role (character vs. object/environment) and reference each by index + description in the prompt** ("Image 1: character reference for X, Image 2: environment reference for the workshop...") rather than treating the reference stack as an undifferentiated pile — the model's own architecture reserves separate conditioning budgets per type.
   *Backed by: Source 5 (Google — separate object-reference vs. character-reference slot counts on `gemini-3-pro-image`), Source 11 (OpenAI — index+describe each reference image explicitly).*

10. **When a trait absolutely cannot drift (a signature prop, a specific expression), consider restating it once more in different words late in the prompt — not by repeating the same phrase, which is redundancy (penalized), but as a distinct reinforcing clause.** Unverified/folklore-tier but cheap and specific enough to test on one real problem shot before adopting.
    *Backed by: Source 12 (practitioner claim — reinforce critical constraints via restatement in different words, not verbatim repetition; explicitly [FOLKLORE], not measured).*

---

### Overall confidence note
The strongest, most directly actionable findings are the vendor-documented numeric ceilings (25 chars/phrase, ≤3 phrases, 5-character-reference-slot budget — Sources 4-5) and the reference-image "state constraints, don't redescribe" guidance that both Google and OpenAI independently converge on (Sources 2, 11) — treat #1, #4, #5, #9 as highest-confidence. The causal-attention first-mention-bias hypothesis (#3) and the resolution-dominance finding (#8) are measured but on different model architectures/domains than ours — treat as testable hypotheses, not settled facts. The negative-framing question (#7) and constraint-reinforcement-via-restatement (#10) are open/unresolved — worth cheap A/B tests on real shots rather than blanket doctrine changes.

