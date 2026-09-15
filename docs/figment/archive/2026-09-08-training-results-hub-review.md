# Training results hub review

The authenticated Figment hub now displays historical preparation and two
completed local-run summaries. This review records the fixture result, not a
production authentication test or a quality decision.

## Recorded projection

The loopback fixture returned a historical preparation snapshot with one
original observation, one repeat, a 768×768 target, an 896×512 effective
bucket, CUDA masked, verified teardown, and two local tokenizer probes. It
also returned these completed, non-quality-evaluated run summaries:

- ten-step availability probe: one checkpoint, 79.234 seconds;
- current-caption fit: 11 checkpoints, 217.629 seconds, with the display
  allowlist at steps 20, 50, and final 100.

The captured projection SHA-256 is
`df76611b503d1877c78193400f3bdbdaa0475b02b0466ad80bb42db51b33ec0f`.
The projected slices contained no private path or raw receipt fields under the
fixture assertions.

## Current matched-pair state

The first matched current step-20 runtime receipt is complete, non-promotable,
and records two 1024×1024 outputs with verified teardown. Its raw SHA-256 is
`a6140543aff6fbf02bd294fa187b76aa477b593f34108bf6600d47f190746ffb`.
The root diagnostic review (`56d6fa6fba66eacf710c4306e071aeb0b9d78ee3dfc3b71959114ad3c7c0c5d9`)
records `continue`; the independent diagnostic review
(`299cfb4ca019c08ebe30d3a5eb2eedbb987f3026399da0195310a6fcaad215e4`)
records `stop`. Both are explicitly non-promotable and `human_qa: false`.
The higher current ladder and concise admission remain stopped while the next
protocol is analyzed.

## Visual check

The root visual review recorded the Training readiness tab at 1440×1600 and
390×844 configured viewports. Both views showed exactly two preparation cards
and two completed-run cards. The older GPU-training and quality-review
placeholders were absent when the run summaries were present.

At desktop width, `clientWidth`, `scrollWidth`, `innerWidth`, and visual
viewport width were all 1440. At the configured 390-wide mobile viewport,
`clientWidth`, `scrollWidth`, and visual viewport width were 375 while
`innerWidth` remained 390; no horizontal overflow was recorded. The desktop
and mobile state SHA-256 values are respectively
`5b3d39ffb53b91554c9803a14e0ae34d9a2d084037a3e6fcc93a187ac4b3fddd` and
`f7d566bca2e058aea1e94d339d25804c38bcd92a2b57ce19dfbf54c12752ea5e`.
The screenshot SHA-256 values are respectively
`6ea270531b80fc5031bffee2cd709cd7044914d5da5bdebbfe5af781104c05b4` and
`2aa1dba4df62aed6a6acb24292a836f08dc7e63ea2431a7ed93e775d420c52e5`.

The fixture runs on loopback with a local Fastify injection and does not prove
production authentication, deployment, present eligibility, output quality,
or checkpoint acceptance.
