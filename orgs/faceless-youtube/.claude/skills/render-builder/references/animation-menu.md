# Animation menu — the shared contract (single source of truth)

The closed animation vocabulary for the layered-motion system. **The data lives in
`animation-menu.json`** (loaded/validated by `scripts/menu.py`); this doc explains it — it never
re-lists the entries (edit the JSON, not prose).

- **Family A — `source: "cutout"`** (generated image layers): rigid transforms + reveals only, NO
  articulation. Each animation declares the **asset** image-gen must produce.
- **Family B — `source: "engine"`** (code-drawn from data): the existing T2 device kit + text; no gen.

**The rule:** VPW / the motion-planner may author ONLY animations on the menu. Extending it is
deliberate — prove the animation in Remotion, add its triple (params × asset × engine) to the JSON,
then it becomes authorable. This is what prevents authoring a motion the engine can't render.
