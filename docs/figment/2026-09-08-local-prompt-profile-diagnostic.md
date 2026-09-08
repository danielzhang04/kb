# Local simple-portrait prompt-profile diagnostic

## Status

`simple-portrait-v1` is an offline manifest option. It has not started ComfyUI,
created a crop, or generated an image. `baseline` remains the launcher default,
so historical full-frame and face-crop manifests and receipts are unchanged.

The completed full-frame V3 image was visually rejected for training. The later
face-crop launcher failed closed at teardown, but its output, manifest, graph,
and recovery observation are preserved. That image can be used as comparison
evidence with its failed-launcher state stated explicitly; it is not a completed
receipt. This profile is therefore a proposed targeted prompt diagnostic, not
an identity claim.

## Fixed planned difference

The intended later condition uses original g01 alone and the existing
`face-crop384` method. It keeps the fixed crop method, reference SHA-256,
model and code pins, IP-Adapter weight, seed `481516234`, 1024-square output,
24 DPM++ 2M/Karras steps, and local runtime unchanged. The sole graph change
from the same-conditioning `baseline` manifest is the full positive and
negative text at CLIP nodes 6 and 7.

The profile is deliberately an all-text intervention. It cannot attribute any
result to a particular phrase, the crop, or the IP-Adapter.

At the current persona and tester-age helper bytes, its rendered prompt is:

```text
Single-person shoulders-up portrait photograph of a woman in her early twenties, about twenty-one, an adult woman's face with a set jawline, an adult woman's proportions and an adult woman's frame, her hands and neck reading the same age as her face. jet-black hair parted in the middle and falling past the shoulders, dark brown eyes. Front-facing neutral face and neutral gaze. Clothed in an opaque black strapped top. Plain unadorned bedroom wall. Natural daylight, natural skin texture with visible pores, photographic realism.
```

Its negative text is:

```text
child, minor, nude, lingerie, explicit, extra person, distorted face, collage, framed portraits, pictures, mirrors, reflections, duplicate people
```

The plan-only validation bound this rendered text as
`a1f03ae0298fc459c86958bc7dd666f0fc1813d60670d0492f4d14fb85d87b7b`,
with persona bytes
`9fdbb536a2e4c9895e332f13e1a4f11a41f938045a8b770d639b663c32be7492`
and tester-age helper bytes
`c4df651bbd4e86563ba951e3013b1f4d96644430d2d3598708a69ff9cc709a38`.
A future manifest must rederive and bind its own current bytes; these values
are a planning snapshot, not operator approval or a durable prompt authority.

## Preconditions for any later comparison

1. A parent must separately admit one fresh local execution. The option accepts
   only the two built-in profile names; it does not accept arbitrary prompt text.
2. A comparison with the preserved crop output must bind that output's exact
   hash, frozen manifest and graph, and recovery observation, and identify the
   original launcher failure. It is a preserved-output prompt comparison, not a
   claim that two launcher runs completed normally; no identical rerun is
   required merely to change that label.
3. Visual review must still assess resemblance to g01, adult presentation,
   intact opaque clothing, realism, extra people, and composition. Profile
   selection does not supply a quality decision, a score threshold, or a
   training admission.
