# channel-forge — the learning loop (mechanized)

The engine that makes run *N+1* smarter than run *N* (Enforcement Contract clause G, spec §7). This turns the
loop from "the model remembers to do it" into a **built procedure the conductor runs**.

## The loop

1. **Capture (during the walk).** Whenever something causes rework, a stage gets it wrong before converging,
   or the human redirects — the conductor calls
   `friction_log.log_friction(channel_dir, stage, note)` (`scripts/friction_log.py`). The log lives at
   `<channel_dir>/.forge-friction.jsonl` (channel root — survives `.workspace` pruning).
2. **Harvest (run-end + on notable friction).** `friction_log.read_friction(channel_dir)` gathers the entries.
3. **Abstract.** Generalize each to a *portable* lesson — not "the Hidden Machine's research was too broad"
   but "research scope must be declared per niche-shape." Never over-fit to one channel/video.
4. **Confirm with the human.** Surface each proposed generalization; the human approves/edits **before** it is
   codified. (Contract clause G — the human owns what becomes law.)
5. **Route to the durable layer.** Fold each confirmed lesson, *integrated in place*, into the right home:
   - a behavior rule → `references/enforcement-contract.md`
   - a stage's option/critic logic → that stage's `references/recipes/<stage>.md`
   - a default resolution → the capability-map defaults / `pipeline-registry.json`
   - a skill's mechanism → the skill itself

## Proof it works

The niche-stage dogfood alone produced **6 fold-ins** this way (manually): virality/Shorts baked into the
niche recipe, faceless baked in, pipeline-fit reframed veto→cost, "resolve don't punt" + "enrich don't
replace" into the contract, and the `routes_to`-optional schema fix. This procedure is that behavior, made a
mechanism so no future terminal has to rediscover it.
