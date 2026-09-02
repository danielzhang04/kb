# Grid 01 — Z-Image calibration

This merged grid uses the trial-04 c03 S1 cell from `probe-a-zimage.yaml` as its base. Each job replaces exactly one axis phrase in that base; the other prompt bytes remain unchanged. The two fixed seeds are `100001` and `200002`, producing 20 variants and 40 cells.

## Base prompt

```text
A candid phone photograph of a woman in her early twenties, about twenty-one, with an adult woman's face and a lean-curvy adult woman's frame. Her jawline is set beneath a soft square face with rounded corners, and her hands and neck read the same age as her face. Her monolid eyes have a slight rise at the outer corners. Her skin is medium tan with an even neutral warmth, visible pores, and a single mole near the left jaw hinge. Dark-brown hair falls below her shoulders in loose, rope-like curls, air-dried with uneven ends. She wears almost no makeup: a thin brown line close to the upper lash, one coat of mascara, her own softly angled brows brushed up, and muted rose balm over her natural lip colour. She is seated on the edge of a bed beside a window in soft daylight, wearing a fully opaque black cotton camisole and one thin silver chain. A friend holds the phone at sitting distance while she slouches, her air-dried hair falling as it settles, her mouth relaxed, looking slightly past the lens as if caught mid-thought; her hands rest naturally in her lap. Her skin is left as skin, with pores visible across her nose and cheeks and light unevenness at the forehead. Her cheeks keep their natural rounded volume without added shadow or cosmetic warmth, and her medium-width mouth carries only balm over its natural colour. The frame feels casual and unperformed, made in a real bedroom. The ordinary phone image has mild lens softness, sensor grain, light JPEG artifacts, ordinary background focus, no computational sharpening, and no HDR halos. Asian-American woman.
```

## Axis substitutions

| Axis | Variant | Exact substituted phrase |
|---|---|---|
| makeup | `bare` | She wears no makeup: her own softly angled brows are untouched, and her bare lips keep their natural colour. |
| makeup | `tinted-balm-mascara` | She wears only tinted muted rose balm and one coat of mascara; her own softly angled brows are untouched. |
| makeup | `light-everyday` | She wears light everyday makeup: a thin brown line close to the upper lash, one coat of mascara, her own softly angled brows brushed up, soft blush, and muted rose balm over her natural lip colour. |
| makeup | `soft-glam-lite` | She wears soft glam-lite makeup: defined lashes, her own softly angled brows brushed up, soft blush, and a satin muted rose lip, with no contour. |
| makeup | `soft-glam` | She wears soft glam makeup: bronze-brown shadow, softly smoked outer corners, subtle brown liner, her own softly angled brows brushed up, and a glossy berry-nude lip, with no bronzer or contour. |
| prettiness | `control` | Her monolid eyes have a slight rise at the outer corners. |
| prettiness | `strikingly-pretty` | Her monolid eyes have a slight rise at the outer corners. She is strikingly pretty, with symmetrical features and clear skin. |
| prettiness | `photogenic` | Her monolid eyes have a slight rise at the outer corners. She is photogenic, shown at a flattering angle with soft flattering window light on her face. |
| prettiness | `pretty-photogenic` | Her monolid eyes have a slight rise at the outer corners. She is strikingly pretty and photogenic, with symmetrical features, clear skin, a flattering angle, and soft flattering window light on her face. |
| body | `control` | with an adult woman's face and a lean-curvy adult woman's frame. |
| body | `slender-small-frame` | with an adult woman's face and a slender body: a narrow waist, a small frame, and visible collarbones. |
| body | `lean-toned` | with an adult woman's face and a lean, toned body: long limbs and a flat stomach visible under the cami. |
| body | `petite-slight-hourglass` | with an adult woman's face and a petite, slim body: a slight hourglass and narrow shoulders. |
| age | `control` | a woman in her early twenties, about twenty-one, with an adult woman's face |
| age | `twenty-one-fresh-faced` | a twenty-one-year-old adult woman, fresh-faced, with smooth skin and a youthful adult face |
| age | `college-age-adult` | a college-age adult woman in her early twenties with youthful adult features |
| age | `very-early-twenties-adult` | a young adult woman in her very early twenties, with a soft youthful adult face |
| posture | `candid-control` | A friend holds the phone at sitting distance while she slouches, her air-dried hair falling as it settles, her mouth relaxed, looking slightly past the lens as if caught mid-thought; her hands rest naturally in her lap. |
| posture | `relaxed-flattering` | A friend holds the phone at sitting distance while she sits in a relaxed but flattering pose: chin slightly down, eyes to camera, a small natural smile, and her hair falling naturally; her hands rest naturally in her lap. |
| posture | `casual-selfie` | She takes a casual selfie with the phone at arm's length, a soft smile, and her eyes looking into the lens; her free hand rests naturally in her lap. |

## Contact sheets

After the 40 images land, set `$gridRun` to the harness output directory and run:

```powershell
$gridRun = "C:/path/to/grid-01-run"
py -3 orgs/figment/pipeline/calibrate/grid_run.py sheet --run-dir $gridRun --axis orgs/figment/pipeline/calibrate/axes/makeup.yaml --out "$gridRun/grid01-makeup-sheet.jpg" --output-prefix grid01
py -3 orgs/figment/pipeline/calibrate/grid_run.py sheet --run-dir $gridRun --axis orgs/figment/pipeline/calibrate/axes/prettiness.yaml --out "$gridRun/grid01-prettiness-sheet.jpg" --output-prefix grid01
py -3 orgs/figment/pipeline/calibrate/grid_run.py sheet --run-dir $gridRun --axis orgs/figment/pipeline/calibrate/axes/body.yaml --out "$gridRun/grid01-body-sheet.jpg" --output-prefix grid01
py -3 orgs/figment/pipeline/calibrate/grid_run.py sheet --run-dir $gridRun --axis orgs/figment/pipeline/calibrate/axes/age.yaml --out "$gridRun/grid01-age-sheet.jpg" --output-prefix grid01
py -3 orgs/figment/pipeline/calibrate/grid_run.py sheet --run-dir $gridRun --axis orgs/figment/pipeline/calibrate/axes/posture.yaml --out "$gridRun/grid01-posture-sheet.jpg" --output-prefix grid01
```
