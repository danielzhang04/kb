# Layered Motion — Phase 3: Engine + build_motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Render a layered shot from the pipeline — `build_motion --motion-plan` merges `layers[]` into motion.json; the real `Video.tsx` composites a plate + animated cutout layers via a data-driven `<LayerView>`, reproducing the spike (MacGregor slide, ship path) but data-driven. Retire the throwaway spike comps.

**Architecture:** Phase 3 of `docs/superpowers/specs/2026-07-12-layered-motion-system-design.md`. `LayerView` folds the proven spike math (`SlideTest.tsx`/`MapTest.tsx`) into a general component dispatched on `animation.type`. Cutout layers use a new render path; engine-drawn overlays stay on their existing path (unification deferred to Phase 5). Cutouts anchor by CSS transform so the engine never needs the PNG's pixel dimensions.

**Tech Stack:** Python 3 (`py -3`, plain-assert tests), TypeScript/React (Remotion 4.x, Node 24).

## Global Constraints

- Plain-assert Python tests (`py -3`); parallel terminals → explicit git paths, never `git add -A`.
- Cutout anchoring is transform-based: `slide`/`bob` anchor **bottom-center** at (x,y) via `translate(-50%,-100%)`; `path`/`appear` anchor **center** via `translate(-50%,-50%)`. Height = `height_frac` × frame height (default: characters 0.66, path objects 0.18); width auto (browser sizes from aspect).
- A shot **with layers** renders `plate` + layers; a shot **without** renders as today (`image`/placeholder). Passthrough is byte-identical.
- Do NOT touch the audio path or the existing overlay path.

---

### Task 1: `build_motion --motion-plan` — merge layers by id

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_motion.py` (add `apply_motion_plan` + the `--motion-plan` arg + call it)
- Test: `.claude/skills/render-builder/scripts/test_motion_plan_merge.py`

**Interfaces:**
- Produces: `build_motion.py::apply_motion_plan(shots, plan) -> shots` — for each derived motion shot whose id has cutout layers in `plan`, set `shot["plate"] = f"plates/{id}.png"` and `shot["layers"] = [{id, src: f"cutouts/{id}-{layer_id}.png", animation}]`. Shots absent from the plan are untouched.

- [ ] **Step 1: Write the failing test** `test_motion_plan_merge.py`

```python
"""build_motion.apply_motion_plan merges cutout layers by id (plain-assert)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from build_motion import apply_motion_plan


def test_merges_cutout_layers_and_leaves_others():
    shots = [{"id": "L13"}, {"id": "L99"}]  # L99 not in the plan
    plan = {"shots": [{"id": "L13", "background": {"mode": "plate", "plate_prompt": "stage"},
             "layers": [{"id": "macgregor", "source": "cutout", "cutout_prompt": "x",
                         "animation": {"type": "slide", "to": [0.5, 0.82], "dur_s": 1.8}}]}]}
    out = apply_motion_plan(shots, plan)
    l13 = next(s for s in out if s["id"] == "L13")
    assert l13["plate"] == "plates/L13.png", l13
    assert l13["layers"][0]["src"] == "cutouts/L13-macgregor.png", l13
    assert l13["layers"][0]["animation"]["type"] == "slide"
    l99 = next(s for s in out if s["id"] == "L99")
    assert "layers" not in l99 and "plate" not in l99, l99


if __name__ == "__main__":
    test_merges_cutout_layers_and_leaves_others(); print("OK")
```

- [ ] **Step 2: Run — expect FAIL** (`ImportError: cannot import name 'apply_motion_plan'`).
Run: `py -3 .claude/skills/render-builder/scripts/test_motion_plan_merge.py`

- [ ] **Step 3: Add `apply_motion_plan` to `build_motion.py`** (place after `derive_shots`)

```python
def apply_motion_plan(shots, plan):
    """Merge a shots.motion.json layer spec into the derived motion shots, by id. Cutout layers ->
    render paths (plates/<id>.png + cutouts/<id>-<layer>.png). Shots absent from the plan are untouched."""
    by_id = {s.get("id"): s for s in (plan or {}).get("shots", [])}
    for shot in shots:
        entry = by_id.get(shot.get("id"))
        if not entry:
            continue
        cutouts = [l for l in entry.get("layers", []) if l.get("source") == "cutout"]
        if not cutouts:
            continue
        sid = shot["id"]
        shot["plate"] = f"plates/{sid}.png"
        shot["layers"] = [{"id": l["id"], "src": f"cutouts/{sid}-{l['id']}.png",
                           "animation": l.get("animation")} for l in cutouts]
    return shots
```

- [ ] **Step 4: Wire the arg + call.** In `main()` add `ap.add_argument("--motion-plan", help="optional shots.motion.json: merge layers into the spec")`. After the shots are derived (where `derive_shots(...)` result is available, before the spec is written), add:

```python
    if getattr(args, "motion_plan", None) and os.path.exists(args.motion_plan):
        import json as _json
        apply_motion_plan(spec_shots, _json.load(open(args.motion_plan, encoding="utf-8")))
```

(Use the actual variable name for the derived-shots list + the argparse namespace as they appear in `main()`; the merge must run before the shots go into the written motion.json.)

- [ ] **Step 5: Run — expect PASS.** `py -3 .claude/skills/render-builder/scripts/test_motion_plan_merge.py` → `OK`. Also re-run `test_build_motion.py` (unchanged, PASS).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/render-builder/scripts/build_motion.py .claude/skills/render-builder/scripts/test_motion_plan_merge.py
git commit -m "feat(render): build_motion --motion-plan merges cutout layers (layered-motion phase 3)"
```

---

### Task 2: Engine — `LayerSpec` types + `<LayerView>` + `Video.tsx` wiring

**Files:**
- Modify: `.claude/skills/render-builder/engine/src/tokens.ts` (add `LayerAnimation`, `LayerSpec`; extend `Shot`)
- Modify: `.claude/skills/render-builder/engine/src/components.tsx` (add `LayerView`)
- Modify: `.claude/skills/render-builder/engine/src/Video.tsx` (render plate + layers when present)

**Interfaces:**
- Produces: `LayerView` (from components) rendering one cutout layer inside the shot Sequence; `Shot.plate?: string | null`, `Shot.layers?: LayerSpec[]`.

- [ ] **Step 1: Add types to `tokens.ts`** (after the `Overlay` union)

```typescript
export type LayerAnimation =
  | {type: 'slide'; from_edge?: 'left' | 'right' | 'top' | 'bottom'; to: [number, number]; dur_s: number; easing?: string; height_frac?: number}
  | {type: 'path'; points: [number, number][]; dur_s: number; draw_line?: boolean; height_frac?: number}
  | {type: 'bob'; amp?: number; period?: number; at?: [number, number]; height_frac?: number}
  | {type: 'appear'; at_s?: number; style?: 'pop' | 'fade' | 'slam'; at?: [number, number]; height_frac?: number};
export type LayerSpec = {id: string; src: string; animation: LayerAnimation};
```

Extend `Shot` — add two optional fields:

```typescript
  overlays: Overlay[];
  transform_note?: string;
  plate?: string | null;
  layers?: LayerSpec[];
```

- [ ] **Step 2: Add `LayerView` to `components.tsx`** (imports: `AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, interpolate, spring, Easing` from 'remotion'; `LayerSpec` from './tokens')

```typescript
const bez = (t: number, pts: [number, number][], w: number, h: number) => {
  const [p0, p1, p2] = pts;
  const u = 1 - t;
  return {
    x: (u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]) * w,
    y: (u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]) * h,
  };
};

export const LayerView: React.FC<{layer: LayerSpec}> = ({layer}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const a = layer.animation;
  const hf = a.height_frac ?? (a.type === 'path' ? 0.18 : 0.66);
  const src = staticFile(layer.src);
  const imgH = hf * height;

  if (a.type === 'slide') {
    const dur = Math.max(1, Math.round(a.dur_s * fps));
    const p = interpolate(frame, [4, 4 + dur], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
    const restX = a.to[0] * width;
    const startX = (a.from_edge === 'right' ? width * 1.2 : -width * 0.2);
    const x = interpolate(p, [0, 1], [startX, restX]);
    const y = a.to[1] * height;
    return <Img src={src} style={{position: 'absolute', left: x, top: y, height: imgH, width: 'auto', transform: 'translate(-50%, -100%)'}} />;
  }
  if (a.type === 'path') {
    const dur = Math.max(1, Math.round(a.dur_s * fps));
    const p = interpolate(frame, [4, 4 + dur], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.ease)});
    const pt = bez(p, a.points, width, height);
    const dots = [];
    if (a.draw_line) {
      const N = 44;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        if (t > p) break;
        const d = bez(t, a.points, width, height);
        dots.push(<circle key={i} cx={d.x} cy={d.y} r={5} fill="#3a2a1a" opacity={0.9} />);
      }
    }
    return (
      <AbsoluteFill>
        {a.draw_line ? <svg width={width} height={height} style={{position: 'absolute', top: 0, left: 0}}>{dots}</svg> : null}
        <Img src={src} style={{position: 'absolute', left: pt.x, top: pt.y, height: imgH, width: 'auto', transform: 'translate(-50%, -50%)'}} />
      </AbsoluteFill>
    );
  }
  if (a.type === 'bob') {
    const amp = a.amp ?? 5;
    const period = a.period ?? 2.4;
    const dy = Math.sin((frame / fps) * (2 * Math.PI / period)) * amp;
    const [x, y] = a.at ?? [0.5, 0.82];
    return <Img src={src} style={{position: 'absolute', left: x * width, top: y * height + dy, height: imgH, width: 'auto', transform: 'translate(-50%, -100%)'}} />;
  }
  // appear
  const atF = Math.round((a.at_s ?? 0) * fps);
  const pop = spring({frame: frame - atF, fps, config: {damping: 12}});
  const [x, y] = a.at ?? [0.5, 0.5];
  return <Img src={src} style={{position: 'absolute', left: x * width, top: y * height, height: imgH, width: 'auto', opacity: pop, transform: `translate(-50%, -50%) scale(${interpolate(pop, [0, 1], [0.8, 1])})`}} />;
};
```

- [ ] **Step 3: Wire `Video.tsx`** — in the per-shot block, render plate + layers when present. Replace the `{shot.image ? (...) : (<PlaceholderCard .../>)}` block with:

```tsx
                    {shot.layers && shot.layers.length ? (
                      <AbsoluteFill>
                        {shot.plate ? <SceneImage tokens={tokens} src={shot.plate} /> : null}
                        {shot.layers.map((ly) => <LayerView key={ly.id} layer={ly} />)}
                      </AbsoluteFill>
                    ) : shot.image ? (
                      shot.idle === 'bob' ? (
                        <Idle tokens={tokens}><SceneImage tokens={tokens} src={shot.image} /></Idle>
                      ) : (
                        <SceneImage tokens={tokens} src={shot.image} />
                      )
                    ) : (
                      <PlaceholderCard tokens={tokens} kind={shot.placeholder?.kind ?? 'missing'} label={shot.placeholder?.label ?? shot.id} />
                    )}
```

Add `LayerView` to the `./components` import and `AbsoluteFill` is already imported.

- [ ] **Step 4: Typecheck the engine.**
Run: `cd .claude/skills/render-builder/engine && npx tsc --noEmit` (or `npm run build` if tsc isn't wired)
Expected: no type errors. Fix any until clean.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/render-builder/engine/src/tokens.ts .claude/skills/render-builder/engine/src/components.tsx .claude/skills/render-builder/engine/src/Video.tsx
git commit -m "feat(engine): LayerView — data-driven cutout layers (slide/path/bob/appear) (layered-motion phase 3)"
```

---

### Task 3: E2E render the fixture + retire the spike comps

**Files:**
- Create: `.claude/skills/render-builder/engine/test-motion-layered.json` (a 2-shot test spec: L13 slide + L03 path)
- Modify: `.claude/skills/render-builder/engine/src/Root.tsx` (remove SlideTest/MapTest)
- Delete: `.claude/skills/render-builder/engine/src/SlideTest.tsx`, `.../MapTest.tsx`

- [ ] **Step 1: Write the test motion.json** (`test-motion-layered.json`) — exercises the engine directly (no VO/audio)

```json
{
  "schema": "faceless-youtube/motion@1", "piece": "test", "video_slug": "2026-07-04-poyais",
  "fps": 30, "width": 1920, "height": 1080, "audio": null, "audio_seconds": 8,
  "captions": {"enabled": false, "style": "long-form", "words": []},
  "shots": [
    {"id": "L13", "start_s": 0, "duration_s": 4, "image": null, "placeholder": null,
     "camera": {"move": "none", "pan": null, "intensity": 0}, "entrance": "cut", "idle": "none", "overlays": [],
     "plate": "plates/L13.png",
     "layers": [{"id": "macgregor", "src": "cutouts/L13-macgregor.png",
                 "animation": {"type": "slide", "from_edge": "left", "to": [0.5, 0.9], "dur_s": 1.8, "height_frac": 0.6}}]},
    {"id": "L03", "start_s": 4, "duration_s": 4, "image": null, "placeholder": null,
     "camera": {"move": "none", "pan": null, "intensity": 0}, "entrance": "cut", "idle": "none", "overlays": [],
     "plate": "plates/L03.png",
     "layers": [{"id": "ship", "src": "cutouts/L03-ship.png",
                 "animation": {"type": "path", "points": [[0.83, 0.24], [0.52, 0.14], [0.12, 0.72]], "dur_s": 3.6, "draw_line": true, "height_frac": 0.18}}]}
  ]
}
```

- [ ] **Step 2: Render it** (publicDir = the video's assets dir, so `plates/`/`cutouts/` resolve)

Run:
```bash
cd .claude/skills/render-builder/engine && node render-video.mjs test-motion-layered.json \
  ../../../../channels/the-second-take/videos/2026-07-04-poyais/assets out/layered-test.mp4
```
Expected: `RESULT seconds=... out=.../layered-test.mp4`.

- [ ] **Step 3: QC frames + human review.** Extract frames (L13 mid-slide + settled, L03 mid-path + arrival) with ffmpeg; open `out/layered-test.mp4` in the Windows player. **Human gate:** MacGregor slides onto the stage plate and rests; the ship paths across the map drawing its route. Confirms the REAL engine reproduces the spike.

- [ ] **Step 4: Retire the spike comps.** Delete `SlideTest.tsx` + `MapTest.tsx`; remove their imports + `<Composition>` entries from `Root.tsx`. Re-run `npx tsc --noEmit` (clean) and `node render.mjs Video` (the demo composition still builds).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/render-builder/engine/test-motion-layered.json .claude/skills/render-builder/engine/src/Root.tsx
git rm .claude/skills/render-builder/engine/src/SlideTest.tsx .claude/skills/render-builder/engine/src/MapTest.tsx
git commit -m "test(engine): E2E layered render of Poyais L13/L03 + retire spike comps (layered-motion phase 3)"
```

---

## Phase 3 done — the real engine renders layered shots from the pipeline. Next: Phase 4 (motion-planner skill) → Phase 5 (hygiene sweep + unify layers/overlays).
