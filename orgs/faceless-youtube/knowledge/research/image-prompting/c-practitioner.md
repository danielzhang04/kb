# C-Sweep: Practitioner Guides + Community Craft

Research task for the faceless-youtube image pipeline: 40-190 still frames per video via
`gemini-3-pro-image` (API), each from a long structured content prompt + fixed flat-cel-cartoon
style suffix, seeded with reference PNGs. Recurring needs this sweep filters for: (1) same cartoon
character identical across dozens of shots, (2) same scene redrawn with exactly one element
changed (delta-chains), (3) short verbatim text baked into the image without garbling, (4) crowd
scenes on one simplified rig, (5) avoiding attribute leakage between multiple figures in one frame,
(6) the model rendering our instruction language as in-image text (a failure to avoid).

SD/ComfyUI-only mechanics (ControlNet, LoRA training, local pipelines) are discarded unless the
underlying idea transfers to API-only prompting against a hosted model.

Status: COMPLETE.

---

## Official model-vendor guides (highest trust — treat as measured/tested)

### Google Developers Blog — "How to prompt Gemini 2.5 Flash Image Generation for the best results"
https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/

- Core principle: **"Describe the scene, don't just list keywords."** Narrative prose beats
  comma-salad keyword lists — this is Google's own framing of how their model was trained to read
  prompts, i.e. the model expects natural-language scene description, not a tag cloud.
- No single rigid field order is mandated, but the worked examples consistently flow: subject/character
  → action/expression → environment/setting → lighting → mood/atmosphere → technical/camera details.
  Example given: *"A photorealistic close-up portrait of [subject], [action], set in [environment]. The
  scene is illuminated by [lighting], creating a [mood] atmosphere. Captured with a [camera details]."*
- Iterative/conversational editing is a first-class feature: follow-ups like *"Keep everything the same,
  but change the character's expression to be more serious"* are the intended interaction model for
  delta-style edits — talk to the same image turn over turn rather than re-describing the whole scene.
- Negative phrasing: Google explicitly recommends **positive restatement over negation** — *"Instead of
  saying 'no cars,' describe the desired scene positively: 'an empty, deserted street with no signs of
  traffic.'"* (Google's own term: "semantic negative prompts.")
- Text-in-image: state the exact text, specify font style, describe how it integrates with the design
  (e.g. logo lockup) rather than just naming the words.
- Character drift acknowledged as a known limitation: *"If you notice a character's features begin to
  drift after many iterative edits, you can restart a new conversation with a detailed description to
  retain consistency."* — i.e. Google's own fix for drift is restart-with-redescribe, not push through.
- **Transfers to us? YES — this is the model vendor's own doc for the exact model family we use (2.5/3
  Pro Image share the same underlying prompting contract per Google's docs).** Directly actionable.

### Google Blog — "Tips for getting the best image generation and editing in the Gemini app"
https://blog.google/products/gemini/image-generation-prompting-tips/

- Names **six prompt components** explicitly: Subject, Composition (shot framing: "extreme close-up,
  wide shot, low angle shot, portrait"), Action, Location, Style, and (for edits) Editing Instructions.
- Edit instructions should be **"direct and specific"** — e.g. *"change the man's tie to green"* — framed
  as targeted single-property edits, not full re-descriptions.
- Multi-image composition guidance: when combining multiple source images, explicitly instruct Gemini to
  "combine their subjects and environments" — implies reference images carry visual truth, prompt text
  carries the combination instruction.
- Character-consistency recipe for a session: **"Establish a clearly defined character with specific
  details in the first prompt,"** then use **follow-up prompts in the same conversation** to place that
  same character in new contexts — consistency here comes from conversational continuity, not
  re-injecting a reference image each time.
- Known limitations named by Google itself: occasional misspelled text, stylization drift across turns,
  aspect-ratio maintenance issues.
- **Transfers to us? YES**, with a caveat — our pipeline is a fresh API call per shot (not one long
  chat), so the "same conversation" consistency trick doesn't directly apply; we rely on reference PNGs
  instead, which Google's own docs treat as the more durable mechanism anyway.

### OpenAI Cookbook — "GPT Image Generation Models Prompting Guide"
https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide

- Recommends a **fixed prompt field order**: background/scene → subject → key details → constraints.
  Different vendor, same instinct as Google's examples: setting/subject before fine detail, constraints
  last.
- Multi-subject/attribute-bleed prevention technique: don't just name two subjects — pin them with
  **explicit relational/geometric language**: scale ("child-sized relative to the table"), framing ("full
  body visible, feet included"), gaze ("looking down at the open book, not at the camera"), and
  interaction ("hands naturally gripping the handlebars"). The claim is that pinning proportion, action
  geometry, and gaze alignment is what stops the model conflating two figures' attributes — more
  concrete than anything found in the Gemini-specific docs.
- Text-in-image: **put literal text in quotes or ALL CAPS**, spell tricky words **letter-by-letter**,
  specify font/size/color/placement, and bump generation quality for dense/small text panels.
- Negative/exclusion phrasing: **state exclusions and invariants explicitly** ("no watermark," "no extra
  text," "no logos/trademarks") AND **repeat the preserve/exclude list on every iteration** in a multi-turn
  edit chain to fight drift. Notably this CONTRADICTS Google's "avoid the word no" guidance — see
  candidate-learnings note below; likely a genuine cross-model difference (GPT-image tolerates direct
  negation, Gemini reportedly reads "no X" as includes-X — flag as unresolved, worth a cheap in-house A/B).
- Delta-edit pattern for a chain: **"change only X" + "keep everything else the same"**, and repeat the
  preserve-list on each subsequent iteration to reduce cumulative drift — directly the shape of our
  delta-chain need.
- Reference-image division of labor: when multiple input images are supplied, **reference each by index
  and description** — *"Image 1: product photo… Image 2: style reference…"* — and describe explicitly how
  they interact/combine ("put the bird from Image 1 on the elephant in Image 2"). This is the cleanest
  concrete answer found anywhere in this sweep for "how much to restate vs. trust the reference": name
  each reference image's role explicitly, then describe the composition delta in text; don't re-describe
  the reference's contents.
- **Transfers to us? YES, high value** — different vendor but the underlying model class (multimodal
  transformer image gen) is close enough that the attribute-pinning and indexed-reference techniques are
  directly testable against gemini-3-pro-image. Flag: the negation-phrasing contradiction with Google's
  own guidance should be resolved empirically before encoding either rule.

---

## Practitioner / community writeups

### prompting.systems — "Ultimate Nano Banana Pro Character Consistency Guide"
https://prompting.systems/blog/nano-banana-pro-character-consistency-guide (WebFetch blocked, 403;
findings below are from the search-result snippet only, not the full article — lower confidence)

- Reference-sheet convention: **3 canonical views** — direct frontal, 45° profile, full 90° side profile
  — described as giving the model "a complete 3D understanding of the character's head structure."
- Key trigger phrase for placing a character in a new scene: **"featuring the same character shown in
  the reference image,"** reinforced with explicit anchor words: "same character," "maintain facial
  features," "preserve proportions."
- **Transfers to us? PARTIAL** — the 3-view reference sheet is exactly our canonical-reference-PNG
  approach already; the trigger-phrase wording is cheap to test and worth adopting if not already in use.
  Treat as folklore/experience-backed only — snippet gave no measured claims and full article wasn't
  reachable.

### imaginewithrashid.com — "How to Create Consistent Characters Using Gemini Nano Banana Pro"
https://imaginewithrashid.com/how-to-create-consistent-characters-using-gemini-nano-banana-pro/

- Reference sheet: main reference is a **single side-by-side composite image** — "close-up portrait on
  the left, full body view on the right" — plus a medium shot for face/upper-body detail, a back view for
  rear design elements, and a simple test scene to verify consistency before real production starts.
  Notable: compositing multiple views into ONE reference image (not 4 separate files) so the model reads
  them as one conditioning input.
- Trigger phrase, same family as prompting.systems: **"featuring the same character shown in the
  reference image. Keep all core design elements consistent."**
- **Restatement strategy — the most concrete finding in this sweep on the "restate vs trust reference"
  question**: this author does NOT rely on the reference image alone. Every new-scene prompt re-lists
  the character's signature identifiers explicitly — for one recurring character: *"pale green eyes,
  copper braided hair with bone rings, war paint, and the scar."* Framed as: restating anchors "locks in
  consistency" on top of the reference, not instead of it. This is a direct, actionable answer to our
  "how much to restate vs trust the reference" question, though it is experience-backed, not measured
  (no A/B given).
- Multi-character-in-one-frame handling: **upload multiple reference images and explicitly name which
  character is which** in the prompt — e.g. *"Character A from the first reference image (the warrior
  with copper hair) stands facing Character B from the second reference image."* Author's own caveat:
  "this takes practice," works "surprisingly well if your references are strong" — no failure-rate data.
- **Transfers to us? YES** — the "restate signature anchors even with a reference PNG present" pattern
  and the indexed multi-character naming pattern are both cheap, concrete, and directly testable against
  our existing reference-PNG + long-prompt setup.

### withlore.co — "AI Storyboarding With Claude Code: How to Keep Characters Consistent Across Every Shot"
https://www.withlore.co/blog/ai-storyboarding-with-claude-code/

- Thesis stated up front, closest thing to a design principle found in this sweep: **"consistency comes
  from visual reference, not text repetition."** This is in tension with imaginewithrashid's
  restate-anchors-anyway finding above — flag both as candidates for our own empirical test rather than
  picking one on faith.
- Two-stage division of labor across models: use whichever model best matches the target art style to
  generate **element reference images** (character sheets, location refs, prop refs) once; then feed
  those references into **Nano Banana Pro specifically for scene composition**, because (per the author)
  it "handles reference image inputs natively" — i.e. treat reference-following as the scene-generation
  model's job, and don't ask the same model to both invent style and hold identity.
- Character reference profile structure per character: canonical name + a 15-50 word visual descriptor +
  **2-3 "visual anchors"** (named distinctive features, e.g. "brass spectacles, silver-white hair bun") +
  one locked, approved reference image before any scene generation starts. The "2-3 anchors, not a full
  redescription" sizing is a useful concrete number.
- Per-shot prompt structure: **50-100 words of scene-only text** (action, environment, lighting, camera
  framing, palette, mood) PLUS reference images passed as explicit inputs, indexed by filename in the
  prompt: *"[Input images: elara-voss.png, brass-key.png, workshop.png]"*. The stated mental model: "the
  model sees exactly what Elara looks like… it just has to compose them into the described scene" — i.e.
  the prompt should describe only what's NEW (action/setting/camera), never redescribe the character.
- Reported outcome (their own project, not a controlled study, but a concrete artifact-level claim): on a
  3-scene/16-shot/11-element storyboard, the locked reference image reuse held a specific visual anchor
  (brass spectacles) present "in every frame she's in."
- Timing data point (useful for our own planning, not a prompting rule): a 3-scene/15-shot storyboard with
  approval checkpoints took 2-4 hours end to end, with most time in reference-quality iteration, not in
  writing shot prompts.
- Does not address multi-character attribute bleed in one frame.
- **Transfers to us? YES, high value** — closest analog to our own pipeline shape (long structured
  per-shot prompt + reference PNGs + a review gate). The anchor-count sizing (2-3 named anchors) and the
  indexed-filename reference convention are both directly adoptable. Flag the reference-vs-repetition
  tension against imaginewithrashid for a cheap in-house test (does restating anchors on top of strong
  references help, hurt, or do nothing on gemini-3-pro-image specifically?).

### Claudio Lassala — "Story-Showing with AI: Comic Book Workflow"
https://lassala.net/2026/04/01/story-showing-with-ai-comic-book-workflow/

- Uses Gemini (via a custom "Gemini gem"/mini-app) configured to read: a **character reference sheet**,
  a scene-by-scene markdown storyboard, and per-panel prompts, generating panels one at a time.
- Pipeline shape close to ours: script/beats → markdown storyboard with scene descriptions AND
  per-panel image-generation prompts → **human review/edit checkpoint on the markdown BEFORE any image
  generation runs** → panels generated one by one.
- No specifics on text-in-image or targeted single-element edits.
- Claims are qualitative, first-person ("I'm liking what I'm seeing," "the results were okay, but not
  quite what I was aiming for") plus one piece of third-party validation ("people have told me directly
  that my drawings helped drive points home") — folklore-tier, not measured.
- **Transfers to us? PARTIAL** — mainly validates our existing gate-before-spend shot-list-review
  pattern (shots.json/board.html review before image-gen) as independently arrived-at good practice; no
  new phrasing technique to extract.

### Flat/vector cartoon style-consistency community writeups (aggregated — multiple thin sources, no single
canonical article; findings triangulated across renderforest.com, enhanceai.art, media.io, neolemon.com)

- **Two-layer prompt system**, stated as the actual named pattern: one fixed block describing the
  character/style that is reused verbatim across every generation (e.g. *"Luna, 8 years old, large round
  eyes, freckles on cheeks, messy auburn bob hair, yellow raincoat, red rain boots, 2D flat illustration
  style, thick black outlines, warm color palette"*), and a second block that changes only the
  per-image variables (pose, setting, action). The framing: "you're not asking the model to re-invent
  the character every time, only the variables change" — structurally this is exactly a fixed style-suffix
  + variable content-prompt, i.e. what our pipeline already does.
- **"More style words = more style soup"**: claim that a long style description (30+ words) causes the
  model to average conflicting descriptors unpredictably, and that a short list of specific, concrete
  tokens (flat colors, crisp edges, simplified shapes, no texture/brush strokes, named limited palette,
  consistent stroke weight) beats a longer vaguer one. Directly relevant to how heavy our fixed style
  suffix should be.
- Palette-locking is treated as necessary, not optional, for brand/recurring-character work: "if the
  cartoon must match brand colors, include the palette every time" — i.e. restate the locked palette in
  every prompt rather than assuming style-transfer from a reference alone.
- All of this tier is folklore/experience-backed — no measurement, thin SEO-content sourcing, several
  near-duplicate articles restating the same claims without attribution to a test. Treat as directionally
  plausible, not proven.
- **Transfers to us? YES, directionally** — validates our existing fixed-style-suffix architecture;
  the "shorter/more concrete beats longer/vaguer" claim is worth testing against our actual style suffix
  length. Low confidence source tier.

### Attribute bleeding / multi-character scenes — cross-source synthesis (getimg.ai, civitai, pixai.art,
skywork.ai, and the academic "Leaky Diffusion" paper, petsymposium.org/popets/2025/popets-2025-0130.pdf)

- Named phenomenon: **"attribute bleed"/"prompt bleeding"** — descriptors meant for one character attach
  to another when multiple subjects share a prompt; canonical example given repeatedly: one character
  described with eyeglasses causes ALL characters in frame to render with eyeglasses.
- The academic paper (SD-specific, diffusion cross-attention mechanics) confirms this is a real, measured
  phenomenon at the architecture level, not just anecdote — but its proposed fixes (attention-map
  manipulation) are SD-internals and don't transfer to an API-only black-box model like gemini-3-pro-image.
  Discarding the mechanism, keeping the finding: attribute bleed is a real, structural risk in ANY
  multi-subject generation, not an SD quirk — worth explicitly designing around rather than assuming a
  newer model has solved it.
- Practical mitigations that DO transfer to API-only prompting (as opposed to SD-only ones like
  ControlNet/regional-prompting/LoRA-weight-tuning, which are discarded): (1) simplify the prompt —
  remove/de-emphasize any descriptor not essential to differentiating the figures, since bleed risk scales
  with shared descriptor density; (2) explicit named-slot assignment per figure (see imaginewithrashid's
  "Character A from reference 1… Character B from reference 2" pattern above) rather than a single run-on
  paragraph describing both; (3) generate/composite characters separately when a scene has many
  distinguishing details per figure and bleed risk is high — this is the one place SD-only "generate
  separately then composite" folklore has a same-shape API analog: for a genuinely dense multi-figure
  shot, consider a locked single-figure reference PNG per figure fed as multiple indexed inputs (per
  OpenAI cookbook's indexed-reference pattern) rather than describing all figures freshly in prose.
- **Transfers to us? YES for the underlying finding and the simplify/named-slots/indexed-reference
  mitigations; NO for any SD-internals fix.** Directly relevant to our "avoiding attribute leakage between
  multiple figures" need.

### Text-in-image rendering — cross-source synthesis (Microsoft Copilot guide, OpenAI cookbook, general
prompting guides)

- Consistent, repeated claim across sources: **keep in-image text short** (rule of thumb cited: under
  ~25 characters / a few words) — matches our own ≤4-word constraint well, treat as validating, not new.
- **Wrap the literal text in quotation marks** (or, per OpenAI cookbook, ALL CAPS) to signal "render this
  string literally" rather than treat it as a content description. Consistent across every source that
  addressed the question at all.
- For longer or unusual words, OpenAI cookbook's letter-by-letter spelling-out suggestion is the only
  source offering a technique beyond "keep it short + quote it" — untested by us, cheap to try given our
  ≤4-word hand-lettered use case.
- No source specifically addressed hand-lettered/stylized text rendering (vs. clean typography) — this
  looks like a gap in the public practitioner literature, not a solved problem; worth treating our own
  in-house test results as the primary evidence here rather than searching further.
- **Transfers to us? YES** — quote-the-literal-text + keep-it-short is corroborated everywhere and
  cheap to enforce as a hard rule in our prompt-writing logic.

### Negative/exclusion phrasing without a negative-prompt field — cross-source, Gemini-specific
(pixeldojo.ai, and corroborating snippets)

- Two competing concrete recommendations surfaced for Gemini specifically, and they conflict with each
  other AND with OpenAI's cookbook guidance (see above) — flagged as the sweep's clearest "test this
  in-house before encoding" item:
  - (a) pixeldojo.ai: **avoid instructive negation words entirely** ("no", "don't") — instead list the
    excluded elements as a bare comma-separated noun list, e.g. *"crowds, boats"* rather than *"no
    crowds, no boats."* No comparative data given — asserted, not measured, per WebFetch's own
    "critical gap" assessment of that source.
  - (b) a different snippet claims Gemini "does not seem to understand the coupling of two negating
    words" and that phrases like "no mountain" or "without facial hair" can produce the OPPOSITE of the
    intended result — recommending a **single-word antonym** instead ("beardless" rather than "without
    facial hair") where such a word exists.
  - (c) Google's own developer blog (see above, highest-trust tier) recommends **positive scene
    restatement** ("an empty, deserted street with no signs of traffic" instead of "no cars") — a third,
    distinct strategy.
  - (d) OpenAI's cookbook, different model, recommends the opposite of (a): state exclusions directly
    ("no watermark," "no extra text") and repeat them each iteration.
- Given four different, partially-contradictory prescriptions across sources of uneven trust, the honest
  synthesis is: **there is no settled community consensus for Gemini-specific negative phrasing**; the
  only claim with an authoritative source (Google itself) is "prefer positive restatement of the desired
  end state over any form of negation," which is also the most general/robust of the four and doesn't
  depend on resolving whether Gemini specifically mishandles negation words.
- **Transfers to us? PARTIALLY — recommend adopting Google's positive-restatement rule as the default,
  and treat "single-word antonym" as a cheap fallback when a natural positive restatement is awkward
  (e.g., avoiding our instruction language leaking into in-image text — see candidate learning #10)
  rather than trusting the bare comma-list technique, which had zero corroboration or measurement.**

---

## Top-10 candidate learnings — ranked, for our prompt-writing logic

Each marked **measured** (vendor/academic evidence with some rigor), **experience-backed** (a named
practitioner's stated, repeated real-world use, no controlled comparison), or **folklore** (asserted
across thin/duplicate SEO content, no traceable original test).

1. **Fixed style-block + variable content-block, both restated every time** — reuse one unchanging
   character/style description verbatim across every generation; change only the per-shot variables
   (action/setting/camera). This is structurally what our pipeline already does (fixed style suffix +
   per-shot content prompt) — the sweep independently converges on it as the right shape.
   *Experience-backed* (community two-layer-prompt convention; corroborated directionally by Google's
   and OpenAI's own field-ordering guidance).

2. **Prefer positive scene restatement over any negation for exclusions** ("an empty street with no
   signs of traffic" rather than "no cars") as the default; keep single-word antonyms ("beardless") as a
   fallback only when a positive restatement is awkward. Do not adopt the untested bare-comma-list
   negative-prompt technique.
   *Measured* (this is Google's own stated guidance for the Gemini image-gen family we use).

3. **Name and index every reference image explicitly in the prompt, and describe only the composition/
   delta in text — don't redescribe what's already in the reference.** ("Image 1: Elara reference…
   Image 2: workshop reference… — Elara stands at her workbench in the workshop.") This is the clearest
   available answer to "how much to restate vs. trust the reference."
   *Experience-backed* (OpenAI cookbook + withlore.co independently converge on indexed-reference
   framing).

4. **For delta-chain edits ("same scene, change one thing"), use explicit "change only X, keep
   everything else the same" phrasing, and repeat the preserve-list on every subsequent edit in the
   chain** to fight cumulative drift, rather than assuming one preserve-instruction holds across a long
   chain.
   *Measured/experience-backed blend* (OpenAI cookbook states this as a rule; Google's own conversational-
   editing framing matches the shape).

5. **Restate 2-3 named signature visual anchors per character in every prompt, even when a strong
   reference PNG is already attached** — don't rely on the reference image alone for identity-critical
   recurring characters. (Tension noted against withlore.co's "consistency comes from reference, not
   repetition" claim — worth a cheap in-house A/B before locking this in either direction.)
   *Experience-backed*, and explicitly contested by another experience-backed source — flag as
   "test before encode," not "encode directly."

6. **For multi-figure scenes, pin scale/framing/gaze/interaction geometry explicitly** ("child-sized
   relative to the table," "looking down at the book, not the camera," "hands gripping the handlebars")
   rather than just naming two subjects and their attributes in one paragraph — this is the most concrete
   lever found against attribute bleed between figures.
   *Experience-backed* (OpenAI cookbook's most specific, actionable technique in this sweep).

7. **When a shot has many distinguishing details per figure (high bleed risk), assign each figure to a
   named, indexed reference slot** ("Character A from reference image 1... Character B from reference
   image 2...") rather than describing both figures freshly in one prose block — simplify shared
   descriptors to the minimum needed to distinguish them.
   *Experience-backed + one academic corroboration of the underlying bleed mechanism* (mechanism is
   SD-specific, but the phenomenon and this mitigation shape transfer to any multi-subject model).

8. **Keep in-image text under ~4-5 words and wrap the literal string in quotation marks (or ALL CAPS)**
   to mark it as literal-render-this rather than descriptive content; for any word the model is likely to
   garble, consider spelling it letter-by-letter in the prompt.
   *Measured/experience-backed blend*, and directly validates our existing ≤4-word constraint rather than
   changing it.

9. **Keep the fixed style-suffix short and concrete rather than long and descriptive** — a handful of
   specific tokens (named palette, named line weight, "flat colors," "no texture") reportedly holds
   better than a long paragraph of style adjectives, which the model "averages" unpredictably. Worth
   testing against our actual style-suffix length, since this is thin-sourced folklore, not measured.
   *Folklore* — thin, duplicated SEO sourcing, no traceable original test, but a cheap, safe hypothesis to
   validate in-house.

10. **Never let our own instruction/meta-language ("the character should," "this shot depicts") sit
    adjacent to the in-image-text quotation** — every text-rendering source treats the quoted string as
    the literal payload; the surrounding prose is scene description the model must NOT mistake for
    render-target text. No source addressed our specific failure mode (model rendering our instruction
    language as in-image text) directly — this is inferred from the "quotes mark literal text" convention
    applied in reverse (unquoted directive language near a text-render instruction is the likeliest
    leak vector) and is the one item in this list we should validate against our OWN failure logs rather
    than trust community sourcing, since no practitioner source discussed this specific failure mode.
    *Folklore/inferred* — flagged as our own hypothesis, not a sourced claim.

