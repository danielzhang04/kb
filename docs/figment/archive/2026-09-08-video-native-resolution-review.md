# Native-resolution video diagnostic review

This review covers the completed non-promotable 1280x704 diagnostic only. It
records local assembly and visual observations; it makes no quality-threshold,
identity, age, checkpoint, or operator-approval finding.

## Bound evidence

| Item | SHA-256 |
| --- | --- |
| `native-resolution-v2.json` | `da8bb56b8d8bd3784325b8388baf535c6a22865495c7b5aab5803d2ed90b00b0` |
| `live-native-resolution-v2/run.json` | `94a68db4b2db36927385bc872882e2ae7f8f77391f8bd20433acea2f09c222d3` |
| `assembled-native-resolution-v2/diagnostic.mp4` | `b0c7cce2b54cfc5dc5c6a104b358282364a537a26c865bebab5e3df3689c7624` |
| `assembled-native-resolution-v2/frame-assembly.json` | `6902767568121ee71d14992df590ef006b0fa40fcf7d632689713728cc95f0f1` |
| `extracted-native-resolution-v2/frame-extraction.json` | `134767a44ccffe9d4c49bd8a62bdee4b4ba67c51b5d8ada04d70f22df89f4820` |
| `assembled-native-resolution-v2/all-81-contact-sheet.png` | `c546f9732c1d680d2c479b9a06addf64ea48dea08ef54302a66594dd1ff5c0d5` |

The local assembly receipt binds all 81 receipt-listed 1280x704 PNGs to the
movie. FFprobe reported 81 frames at 16 fps and a 5.062500-second duration.
The independently extracted frame hashes are `first`
`6e8e33ec29da7119a0624a5e113825fb329090e1dfb4df66b735bacc88407c6a`,
`middle` `3e84a65c214a8f8440f337496aaa7477458c5b7a8b326a0b6efe70596b4309f3`,
and `last` `a44aa20c9841ed48e1361581f7df80d5f3f2b3ee7455016acd23dd258dbc5a19`.

## Observations

I inspected the 81-frame contact sheet and the first, middle, frame 60, and
last originals. The room geometry, black shirt, hair, and face remain visually
coherent through the clip. Frame 60 depicts a closed-eye blink; the later
frames show a small head tilt. I did not observe the broad vertical rainbow
bands, warped room geometry, or late-frame face blur visible in the V1 contact
sheet.

The figure is clothed throughout in an opaque, intact black shirt. The visual
presentation is adult-coded, but these generated frames cannot establish a
person's exact age, identity, or resemblance to any reference. They also do
not assess audio, longer motion, other camera angles, other prompts, or other
seeds.

For context, V1's local run receipt and assembled movie hash to
`9172e3cf0de1ae39f39708e562400316ea1601a46518c2781e12b3695b2fc9db` and
`2084e7f6cb5ad1ea954524f8b5c14b92e5ef319405aad6653250ef875aaea674`.
V1 visibly accumulated chromatic vertical streaks and geometric deformation;
V2 did not show comparable degradation in this inspected 81-frame sequence.

The manifest records resolution as the intended changed factor (512x288 to
1280x704) while retaining 81 frames. This single pair is consistent with the
resolution change improving the observed result, but separate executions can
also vary. It does not establish a causal mechanism or a general quality
result.

## Limits

The manifest declares this diagnostic non-promotable, and the locally generated
assembly and extracted-frame receipts retain `not_promotable: true`. The
harness `run.json` binds the completed output but does not itself contain that
field. This review does not promote the run, approve a workflow, or authorize a
further run.
