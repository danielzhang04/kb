# Animation menu — the shared contract (single source of truth)

The closed animation vocabulary for the layered-motion system. **The data lives in
`animation-menu.json`** (loaded/validated by `scripts/menu.py`); this doc explains it — it never
re-lists the entries (edit the JSON, not prose).

- **`source: "cutout"`** (generated image layers) — the **only authorable family**: rigid transforms +
  reveals only, NO articulation (`appear`/`bob`/`slide`/`path`). Each animation declares the **asset**
  image-gen must produce. The one engine-DRAWN element that survives is the **`draw_line`** param on
  `path` — the engine trails route dots along the cutout's bezier; everything else in a cutout layer is
  the generated image.
- **Retired — the `source: "engine"` family:** the T2 device kit + diegetic text is gone from the menu
  (2026-07-15). In-video text is now baked into the generated images; the Remotion components are parked
  (see `motion-schema.md` §3). `animation-menu.json` therefore carries only the `cutout` family, and
  `menu.py` / `motion_plan.py` reject any `source:"engine"` layer.

**The rule:** VPW / the motion-planner may author ONLY animations on the menu. Extending it is
deliberate — prove the animation in Remotion, add its triple (params × asset × engine) to the JSON,
then it becomes authorable. This is what prevents authoring a motion the engine can't render.
