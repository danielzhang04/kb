# Figment content brief hub plan

## Purpose

The hub should show the offline content briefs already recorded under
`orgs/figment/content/briefs/`. These are planning snapshots. Their presence does
not prove that the compiler inputs are still current, that assets were produced,
that anyone reviewed quality, that a checkpoint or image was accepted, or that
content was published or performed well.

The implementation is split into a server collector slice and a separately
reviewed route and Research-tab integration slice.

## Read contract

`collectContentBriefs(repoRoot)` resolves one fixed repository-relative location:
`orgs/figment/content/briefs`. It enumerates at most 64 immediate entries and may
read only `<one-level-folder>/brief.json`. It does not accept a request path or a
configurable briefs path, recurse below that file, fetch citations, or open persona,
reference, media, checkpoint, taxonomy, or template files.

The collector rejects links and junctions, path escapes, directory overflow,
records larger than 256 KiB, JSON deeper than 32 levels, malformed compiler fields,
approval or publication-bearing keys, and non-null `observed_metrics`. The depth
scan runs before JSON parsing and recursive key inspection. Failures return only
the sanitized reason `evidence-unavailable`.

Projection states distinguish:

- `not-configured`: no repository root was supplied.
- `empty`: the fixed inventory directory or compiled briefs are absent.
- `unavailable`: existing inventory evidence cannot be read safely or validated.
- `recorded`: one or more bounded planning snapshots were projected.

Recorded and empty inventory responses state `recordKind: planning-snapshot` and
`currentSourceRevalidated: false`.

## Projected fields

Each recorded item includes only:

- brief identifier and date;
- creator identifier;
- surface and template identifier;
- required asset count and each slot's role and persona/nonpersona kind;
- hypothesis and intended metric;
- source count and recorded observation dates;
- `observedMetrics: null`; and
- `renderAs: text`.

The projection omits citation URLs, persona and reference paths, hashes, arbitrary
extra record fields, and any operational or approval state. Text is bounded and
control-character free. A client must insert it as text content and must not treat
it as HTML.

## Integration contract

The existing protected Figment read response adds an optional `contentBriefs`
field. Making the field optional keeps older server/client pairs compatible. The
Research tab renders recorded briefs as inert text cards, shows `empty` separately
from unavailable evidence, and repeats that these are recorded plans without
current-source revalidation or observed results.

This integration adds no route, action, mutation, external request, or media read.
It uses the existing protected read scope.

## Verification

The collector test slice covers valid projection and redaction, omitted and empty
inventories, malformed, oversized, and over-deep JSON, approval-bearing fields,
non-null metrics, a one-level junction, physical entry overflow, and the checked-in
compiled brief. The collector is checked by dashboard typechecking. A production
build follows the separate route and Research-tab integration slice.
