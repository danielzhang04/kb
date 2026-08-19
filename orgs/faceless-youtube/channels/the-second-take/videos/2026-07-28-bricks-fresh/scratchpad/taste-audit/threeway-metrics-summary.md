# Three-way pixel metrics — LIKED vs V2 vs FRESH

FRESH is limited to manifest-verified L01–L25 frames. Excluded: L09 (parked).

Each set cell is mean (p10; p90) across images. Per-image values, formulas, and the full outlier records are in `threeway-metrics.json`.

| metric | LIKED | V2 | FRESH | V2 → FRESH verdict | per-shot outliers (>1.5σ from LIKED) |
| --- | --- | --- | --- | --- | --- |
| Warmth: mean R-B | 37.6799 (p10 2.8672; p90 69.8432) | 52.9867 (p10 25.8264; p90 76.7387) | 64.8392 (p10 41.7083; p90 82.2901) | away | V2: L12.png (-36.3144); L01.png (97.3562); FRESH: — |
| Warmth: p10 R-B | -5.5385 (p10 -35.8000; p90 12.8000) | 10.7200 (p10 -55.6000; p90 44.8000) | 22.7500 (p10 -8.1000; p90 48.0000) | away | V2: L12.png (-77.0000); L04.png (-74.0000); L11.png (-62.0000); L01.png (48.0000); L14.png (48.0000); L10.png (46.0000); L07.png (43.0000); L03.png (39.0000); L20.png (39.0000); FRESH: L07.png (48.0000); L08.png (48.0000); L23.png (48.0000); L24.png (48.0000); L25.png (48.0000); L14.png (39.0000); L13.png (38.0000); L15.png (38.0000) |
| Saturation: mean HSV S | 0.3259 (p10 0.1267; p90 0.4660) | 0.4439 (p10 0.3530; p90 0.5588) | 0.4249 (p10 0.3373; p90 0.5034) | toward-liked | V2: L01.png (0.6671); L12.png (0.6333); L03.png (0.5669); L22.png (0.5468); FRESH: — |
| Saturation: grey share (S < 0.08) | 0.0942 (p10 0.0029; p90 0.2297) | 0.0200 (p10 0.0000; p90 0.0405) | 0.0233 (p10 0.0006; p90 0.0598) | flat | V2: —; FRESH: — |
| Palette commitment: top-3 of 16 colors | 0.2953 (p10 0.2446; p90 0.3662) | 0.3109 (p10 0.2655; p90 0.3591) | 0.3069 (p10 0.2541; p90 0.3532) | flat | V2: L14.png (0.4706); L13.png (0.3843); L16.png (0.3618); FRESH: L13.png (0.5009); L08.png (0.3839) |
| Accent pop: high-S, hue-distant share | 0.0320 (p10 0.0000; p90 0.0039) | 0.0133 (p10 0.0000; p90 0.0147) | 0.0009 (p10 0.0000; p90 0.0032) | away | V2: L11.png (0.2475); FRESH: — |
| Light: mean HSV V | 0.5924 (p10 0.4530; p90 0.6883) | 0.6028 (p10 0.4653; p90 0.7048) | 0.6918 (p10 0.6290; p90 0.7935) | away | V2: L12.png (0.3405); L09.png (0.3586); FRESH: — |
| Light: murk share (V < 0.25) | 0.1117 (p10 0.0458; p90 0.0938) | 0.1018 (p10 0.0332; p90 0.2891) | 0.0595 (p10 0.0295; p90 0.0962) | away | V2: L09.png (0.3778); FRESH: — |
| Edge/detail: mean gradient magnitude | 0.0272 (p10 0.0166; p90 0.0403) | 0.0340 (p10 0.0199; p90 0.0459) | 0.0491 (p10 0.0321; p90 0.0660) | away | V2: L07.png (0.0531); L21.png (0.0482); L02.png (0.0461); L08.png (0.0456); L20.png (0.0445); L03.png (0.0439); FRESH: L06.png (0.0698); L05.png (0.0697); L04.png (0.0663); L03.png (0.0655); L02.png (0.0626); L17.png (0.0611); L25.png (0.0592); L01.png (0.0589); L24.png (0.0569); L16.png (0.0561); L08.png (0.0547); L23.png (0.0540); L07.png (0.0525); L21.png (0.0428) |
| Edge/detail: 4x4 grid density std | 0.0102 (p10 0.0062; p90 0.0127) | 0.0154 (p10 0.0092; p90 0.0213) | 0.0168 (p10 0.0104; p90 0.0230) | away | V2: L15.png (0.0277); L02.png (0.0227); L13.png (0.0216); L06.png (0.0209); L21.png (0.0206); L10.png (0.0205); L07.png (0.0205); L20.png (0.0193); L08.png (0.0189); L09.png (0.0184); L03.png (0.0170); L04.png (0.0162); L11.png (0.0045); L12.png (0.0053); FRESH: L04.png (0.0255); L05.png (0.0233); L07.png (0.0231); L08.png (0.0227); L25.png (0.0224); L24.png (0.0219); L06.png (0.0211); L23.png (0.0208); L17.png (0.0196); L16.png (0.0181); L15.png (0.0176); L14.png (0.0161); L03.png (0.0159); L13.png (0.0156); L02.png (0.0152) |
| Openness proxy: contiguous quiet-space share | 0.1816 (p10 0.0000; p90 0.4494) | 0.1974 (p10 0.0521; p90 0.3369) | 0.0850 (p10 0.0220; p90 0.2466) | away | V2: —; FRESH: — |
| Depth proxy: horizontal luminance/edge bands | 6.6923 (p10 5.0000; p90 8.0000) | 7.8000 (p10 5.4000; p90 10.0000) | 7.5417 (p10 5.0000; p90 10.0000) | toward-liked | V2: L16.png (12.0000); L15.png (11.0000); L02.png (10.0000); L12.png (10.0000); L13.png (10.0000); L17.png (10.0000); L05.png (4.0000); FRESH: L17.png (11.0000); L11.png (10.0000); L12.png (10.0000); L15.png (10.0000); L22.png (10.0000) |

## Proxy formulas

- **Openness:** On a 160×90 resize, retain pixels whose 9×9 local mean luminance-gradient is ≤0.018 and whose local HSV-S standard deviation is ≤0.075; count only 8-connected retained regions ≥144 pixels (1% of the resize), and divide their area by the frame. It is a quiet sky/wall/air proxy, not semantic empty-space segmentation.
- **Depth layering:** On the same resize, split the frame into 12 horizontal strips. Smooth each strip’s mean luminance and edge-density profile, quantize them (0.08 luminance; 0.012 edge-density), merge one-strip blips, then count contiguous distinct paired regimes. It is a fore/mid/back proxy, not a 3D depth estimate.
- **Verdict rule:** FRESH is toward-liked when its set mean is closer to LIKED’s mean than V2’s by >0.10 LIKED sample SD; farther is away; otherwise flat.
