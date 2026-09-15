# Built-in six-image pilot independent review — 2026-09-09

## Evidence inspected

I inspected g01 and all six pilot PNGs at their original resolution. The PNG
bytes and SHA-256 values match MAIN
`_private/figment-builtin-pilot-20260909-v1/inventory.json`; all six are
1086×1448. I also read the per-slot requests in `prompts.json`.

| file | bytes | SHA-256 |
| --- | ---: | --- |
| `01-turn-left.png` | 1,998,075 | `38176c8589fdfac70196cce03355dceba47d8ac1e0861bdbabde0c8b1fb11de4` |
| `02-turn-right.png` | 1,985,665 | `a75248694ba23a14650b5ed5c650734f74b27c5dda48149d7a2c7d12c54b0abc` |
| `03-full-body.png` | 2,030,177 | `9204557aa9f911825a224d7df841592a760edd45a510843e96a840484095bdc8` |
| `04-outdoor-hoodie.png` | 2,481,869 | `38033b4e1f67a58064adb0ac76ad1fba47a8927f84ba138b7b24df17414fb222` |
| `05-seated-smile.png` | 2,056,618 | `9e68c92aec76b465640e9c3e642840e40c67cbd4be038f65284b1b325aba541c` |
| `06-close-side-light.png` | 2,227,074 | `8d135738f70ee84f488bc48d49ae51f13cfc41989db879d613c036c78c89543b` |

The sole anchor is `g01.jpg`, 737,366 bytes, 1408×768, SHA-256
`e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`.

## Per-image observations

### 01 — turn left

The output preserves g01's eye and eyelid shapes, straight brow spacing, rounded
nose tip, full lips, cheek fullness, jaw, hairline, long centre-parted black
hair, and hoop earrings. The torso and nose turn mildly toward image-left while
the eyes return to camera. The frame includes the whole head, headroom, both
elbows and hands, hips, and upper thighs. The black crew-neck T-shirt and jeans
are opaque and coherent. Skin has visible pores and mild tone variation; hair,
denim, and cotton retain plausible texture. Hands and body anatomy look intact.

### 02 — turn right

This reads as the same person as g01 and slot 1, with a modestly different head
and torso angle toward image-right and direct gaze. The requested opposite turn,
whole-head-to-upper-thigh framing, hands, elbows, outfit, wall, and soft light are
present. The chin and lower face look slightly narrower than slot 1, but the eyes,
nose, lips, hairline, and cheeks remain consistent. Skin, hair, fabric, hands, and
body proportions remain photographic and coherent.

### 03 — full body

The front-facing frame includes the full head, both hands, both legs, and both
white shoes with margins above and below. The neutral stance is somewhat formal,
but it follows the declared slot. Despite the smaller face in frame, the eye,
nose, lip, cheek, jaw, hair, and makeup pattern remains recognizable from g01 and
the closer pilot images. Clothing, fingers, legs, feet, and shoes are coherent.
The wall, floor, fabric, and skin read as a natural photograph.

### 04 — outdoor hoodie

The concrete wall, overcast light, gray hood-down hoodie, jeans, direct gaze,
below-hip crop, elbows, and hands all follow the request. The layered necklaces
and cross reflect the source rather than introducing unrelated jewelry. The face
remains consistent with g01 and the indoor images, though diffuse outdoor light
makes the cheeks and nose read slightly softer. Concrete, hoodie knit, hair,
skin, and background depth are convincing. Hands and clothing coverage are
sound.

### 05 — seated smile

The subject is seated on the requested wooden chair with a small closed-mouth
smile, direct gaze, both hands on her thighs, both elbows, and both knees in
frame. The expression changes the cheek and lip contour without replacing the
underlying eye, nose, jaw, hairline, or face proportions. The smile is restrained
and the person remains consistent across the set. Hands, chair contact, clothing folds,
and body proportions are plausible. The image retains natural skin and room
texture.

### 06 — close side light

The close head-and-shoulders view has direct gaze, a neutral closed mouth, the
whole head, neck, shoulders, and subtle brighter window light from image-left.
It provides the clearest comparison to g01: eyelids, brows, nose, lips, cheeks,
jaw, hairline, and makeup remain closely aligned. Pores, small skin-tone changes,
fine hairs, eyelashes, stray hair, and cloth texture remain visible without the
plastic smoothing seen in the rejected cloud pairs. No anatomy, clothing, text,
or framing defect is apparent.

## Whole-set assessment

The six images form a visually consistent same-person hypothesis across two mild
turns, frontal full-body distance, an outdoor clothing change, a seated mild
smile, and close side lighting. Minor variation in lower-face width and softness
is compatible with angle, distance, expression, and light; I do not see a clear
identity break. All subjects read as clearly adult and plausibly around twenty-one,
but an image review cannot prove an exact age. Every image is fully clothed with
opaque garments. I found no extra people, extra or fused limbs, malformed hands,
unsafe clothing, text, watermark, collage, or split panel.

**Verdict: promising for a curated 20-plus-image research set.** This verdict
supports continued research generation and review only. It is not dataset
approval, production approval, or permission to promote any image without the
existing lineage and review process.

Confidence is moderately high for consistency within these six tested conditions
and lower for identity generalization beyond them. All judgments depend on one
anchor; there is no independent reference-angle validation. Steep profiles,
stronger expression changes, occlusion, motion, difficult light, and broader
wardrobe and setting diversity remain untested. A larger set should preserve
direct g01 conditioning and review originals individually as well as side by side.
