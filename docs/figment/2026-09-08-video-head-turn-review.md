# Head-turn video diagnostic review

This records local assembly, extraction, and visual inspection of the completed
non-promotable V3 diagnostic. It makes no quality-threshold, identity, age,
checkpoint, or operator-approval finding.

## Bound evidence

| Item | SHA-256 |
| --- | --- |
| `head-turn-v3.json` | `99c5b8b2f470be477b7439c433a3834e82d3eaf82ab805687a197358415d7208` |
| `live-head-turn-v3/run.json` | `1f024e43299bcc956bfba2d78fc261842499603e3fa222cf4d506a0d7fc6e3ce` |
| `assembled-head-turn-v3/diagnostic.mp4` | `53d05b3818f0aa9f34afd6d523a0b988aab9e3ef7ba75d0820e02a026321ef5a` |
| `assembled-head-turn-v3/frame-assembly.json` | `73666c1139a6827dbe4c984a49311ae321e89097f9db2a6a4287c5bcffe5fee9` |
| `extracted-head-turn-v3/frame-extraction.json` | `341cf1d6c3d703135104bc6e31119b3658f2d2d119d3a5d27868aaa9d3b87df8` |
| `assembled-head-turn-v3/all-81-contact-sheet.png` | `eb903b123c12111accc6330cfffc0f9db82abe8e9b69de550c109b1b244e7c10` |

The local assembly receipt binds the 81 receipt-listed 1280x704 PNGs to a
5.062500-second, 16-fps MP4. The independently extracted frame hashes are
`first` `673c6400a251013eef3104df0f3a555a06bfd6c412653430d84af60c48600b37`,
`middle` `386b3508676e0be5cfddb242790b9f68fc1a89a77fbf1e328cd0496917aa016b`,
and `last` `595934cf20c44076f2d7e1a9c4bc95741bc0662a54b609d67c5e602a5b260b0a5d`.

V3 retains V2's start image, seed, 81-frame 1280x704/16-fps configuration,
model pins, sampler, and bounds. Its intended execution-graph change is the
positive motion text; it asks for a slow turn and return, a gentle blink, a
locked camera, mostly still shoulders, and intact opaque clothing.

## Visual observations

I inspected the 81-frame contact sheet and the frame 1, 12, 24, 36, 48, 56,
64, 72, and 81 originals. The room, black shirt, hair, and face remain visually
coherent through the sequence. I did not observe V1-style vertical rainbow
streaks, broad room-geometry deformation, or late-frame face collapse. The
shirt remains opaque and intact; no raised hands, face occlusion, speech, or
scene change is visible.

The clip has a gradual pose change and a closed-eye interval, with more
downward/lateral head movement later in the sequence. It does not visibly show
an unambiguous slow turn to the specified side followed by a return to a frontal
pose. This visual review does not measure angle, so it makes no claim that the
motion reached or missed a precise 30-degree value.

Compared with the V2 contact sheet, V3 remains similarly stable and avoids the
earlier V1 degradation. V3's visible motion is somewhat more pronounced than
V2's small late tilt, but it does not yet demonstrate the requested
turn-and-return action. Appearance continuity within this single clip is not a finding
about identity or resemblance to any reference.

## Limits

This is one prompt-only diagnostic beside V2, with one seed, one start image,
and a five-second sequence. It cannot establish a general motion capability,
identity retention, exact age, realism, clothing safety beyond the inspected
frames, or a causal explanation for the visual difference. The manifest is
non-promotable; local assembly and extraction receipts retain that status. This
review does not promote the run or authorize another one.
