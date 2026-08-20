/**
 * U16 — the single renderer for "which model tier is this costing us".
 *
 * The dashboard shows model choice in a dozen places (agent rows, run detail, routing overrides, cost
 * ledgers). Left to each view, that becomes a dozen ad-hoc strings and no shared visual grammar, so an
 * operator scanning a fleet can't see cost weight at a glance. This component gives it ONE chip, styled
 * off the `--model-*` tokens in styles/app.css, which are aliases of the risk-tier ramp — cost weight
 * reads on the same cheap->expensive gradient the eye already learned for risk (see the MODEL note in
 * that file's header).
 *
 * The mapping below is transcribed from governance/model-routing.yaml — both `runtimes.*.aliases` (what
 * a human writes) and `runtimes.*.known_models` (the concrete ids server/routing/effective.ts resolves
 * those aliases into before anything reaches the wire). That file is human-edited only and is the
 * routing authority; this is a presentation mirror of it, not a second source of truth. When a model is
 * added there, add it here — and until someone does, the badge renders the unrecognised name as a plain
 * chip rather than guessing a weight. That matters because this renders against live daemon data: a
 * model this build has never heard of is an expected input, not a crash.
 *
 * Not yet wired into any view — U4 adopts it at the call sites.
 */

/** The weight classes the tier ramp encodes. Ordered cheap -> deep. */
export type ModelWeight = 'cheap' | 'standard' | 'deep';

/**
 * Every model name governance/model-routing.yaml can put in front of this badge, mapped to its weight.
 * Keys are lowercase; lookup normalises.
 *
 * BOTH halves are required. The aliases are what a human writes in a card or an override; the concrete
 * ids are what actually reaches the UI, because server/routing/effective.ts resolves each alias through
 * `runtimes.*.aliases` and then guards the result against `known_models` before it goes on the wire. So
 * on live data every value here arrives as a concrete id — an alias-only table would render colourless
 * in production while looking perfectly correct in a test that feeds it aliases.
 */
const ALIAS_WEIGHT: Readonly<Record<string, ModelWeight>> = {
  // runtimes.claude.aliases
  fable: 'deep', // manager / boss terminal / orchestrator
  opus: 'deep',
  sonnet: 'standard',
  haiku: 'cheap',
  // runtimes.claude.known_models — what effective.ts actually emits
  'claude-fable-5': 'deep',
  'claude-opus-5': 'deep',
  'claude-sonnet-5': 'standard',
  'claude-haiku-4-5': 'cheap',
  // runtimes.codex.aliases
  'codex-deep': 'deep',
  codex: 'standard',
  'codex-cheap': 'cheap',
  // runtimes.codex.known_models
  'gpt-5.6-sol': 'deep',
  'gpt-5.6-terra': 'standard',
  'gpt-5.6-luna': 'cheap',
};

/** Shown when there is no tier to show at all — never a bare `undefined` leaking into the UI. */
const NO_TIER = '—';

/**
 * Resolve a routing alias to its weight class, or `null` if it isn't one we know.
 * Exported because callers occasionally need the weight without the chip (sorting, grouping, totals).
 */
export function modelWeight(tier: string | null | undefined): ModelWeight | null {
  if (typeof tier !== 'string') return null;
  const key = tier.trim().toLowerCase();
  return key in ALIAS_WEIGHT ? ALIAS_WEIGHT[key] : null;
}

export interface ModelBadgeProps {
  /** A routing alias (`sonnet`, `codex-deep`, ...). Unknown/absent values degrade to a plain chip. */
  tier?: string | null;
  /** Display text, when the concrete model id is more useful than the alias (e.g. `gpt-5.6-sol`). */
  label?: string;
}

export function ModelBadge({ tier, label }: ModelBadgeProps): React.JSX.Element {
  const weight = modelWeight(tier);
  const trimmed = typeof tier === 'string' ? tier.trim() : '';
  const text = label ?? (trimmed === '' ? NO_TIER : trimmed);

  return (
    <span
      className={`mc-badge mc-mono${weight ? ` mc-badge--model-${weight}` : ''}`}
      // The raw alias stays reachable on hover even when `label` shows a concrete model id, so the
      // mapping this component applies is inspectable from the UI rather than only from the source.
      title={trimmed === '' ? undefined : trimmed}
      {...(weight ? { 'data-model-weight': weight } : {})}
      data-testid="model-badge"
    >
      {text}
    </span>
  );
}
