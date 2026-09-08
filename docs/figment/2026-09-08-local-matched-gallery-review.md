# Local matched gallery review

The authenticated Figment Asset review view was exercised through a private
loopback fixture using the fixed historical base and current-20 pair roots. It
is a visual and projection check only; the fixture does not establish a
production-authentication claim, a quality acceptance, a human-QA result, or a
promotion.

The projected gallery recorded two ordered seeds, each with one base and one
current step-20 image. All four loaded at their recorded natural 1024 by 1024
dimensions. The page displayed the recorded root `continue` and independent
`stop` dispositions together: four root `continue` summaries (base and
current for both seeds) and two independent current `stop` summaries. The
disagreement remained visible; nothing in the view resolves it or offers a
next-stage action.

| Capture | Configured viewport | Client / scroll width | Image result | SHA-256 |
| --- | ---: | ---: | --- | --- |
| Desktop | 1440 x 1600 | 1425 / 1425 | four natural-size images | `D9617DB50E82C07345F15476319EC78E21755A568D358CE828BEDA4D87841877` |
| Mid-width | 900 x 1200 | 885 / 885 | four natural-size images | `587E341133D8F54AD78BADA1CAF62B642D3F62D24B29AFD07F5B4B6A7B064880` |
| Mobile | 390 x 844 | 375 / 375 | four natural-size images | `D74E540FBA89838839C36E2A0D08223B10504C0C4ACDA7BFE8A6C497573E4AC0` |

The corresponding state files record the selected Asset review tab, the four
opaque image identifiers, natural dimensions, disposition counts, requests,
and viewport measurements:

- Desktop: `6CCFDE13E5089928D353312766BC426A1CB99B7D3298EFA26F7FF97D9D248231`
- Mid-width: `B467A3F9F38E4947783F7551665A40ECFBBABBCFE9EEA6F2F61C5894D4F89CE4`
- Mobile: `428F51EA91CEFA54EF9CC8EDBD6639F8AA522695690E82679CB511E099B65261`

The projection snapshot hash is
`8F3285693C62AECAC78A8D2B698AE7E650C0C61A0D8A5C00E214592D51322146`.
Its gallery slice contained no private paths and no structural implementation
keys such as filenames, receipts, admissions, prompts, logs, or process IDs.
The capture initially rejected the literal word “checkpoint” inside a recorded
free-text diagnostic observation. That was a false positive because those
bounded observations are intentionally displayed verbatim. The final capture
instead checks private-path patterns and structural keys while preserving the
recorded observations.

Focused UI verification passed 20 tests after the final layout/loading and
empty-diagnostic correction. The composed focused server/UI set previously
passed 136 tests, and dashboard typechecking passed. The fixture made four
matched-gallery image GETs per viewport and made no action request.
