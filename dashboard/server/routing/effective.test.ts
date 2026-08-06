/**
 * R2.1 parity suite — the SAME precedence cases as tests/test_routing.py, asserting the TS projection
 * resolves identically to the authoritative Python resolver. Each case mirrors a named Python test.
 */
import { describe, it, expect } from 'vitest';
import { parseYaml } from './yaml.ts';
import type { PolicyDoc, OverrideDoc } from './policy.ts';
import {
  resolveRouting,
  effectiveForCard,
  effectiveForAgent,
  RoutingError,
  SAFE_DEFAULT,
  defaultWorkerFor,
  runtimeOfWorker,
} from './effective.ts';

// The exact POLICY_YAML fixture from tests/test_routing.py §1.
const POLICY = parseYaml(`version: 1
runtimes:
  claude:
    default_worker: worker-desktop
    aliases:
      opus: claude-opus-4-8
      sonnet: claude-sonnet-5
      haiku: claude-haiku-4-5
    known_models: [claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5]
  codex:
    default_worker: codex-worker
    aliases:
      codex: gpt-5-codex
    known_models: [gpt-5-codex]
policy:
  scout:
    "*": { runtime: claude, model: haiku }
  manage:
    "*": { runtime: claude, model: opus }
  work:
    T1: { runtime: claude, model: sonnet }
    T2: { runtime: claude, model: sonnet }
    T3: { runtime: claude, model: opus }
  inspect:
    "*": { runtime: claude, model: opus }
  consolidate:
    "*": { runtime: claude, model: opus }
role_default: { runtime: claude, model: sonnet }
`) as PolicyDoc;

const EMPTY_OVERRIDE: OverrideDoc = { overrides: [] };

function meta(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'card-1', owner: 'worker-desktop', runtime: null, model: null, ...extra };
}

function ov(text: string): OverrideDoc {
  return parseYaml(text) as unknown as OverrideDoc;
}

describe('parity: policy rung', () => {
  it('test_policy_role_tier_lookup — work/T3 -> opus, scout -> haiku (alias resolved)', () => {
    expect(resolveRouting(meta(), 'work', 'T3', POLICY, EMPTY_OVERRIDE)).toEqual({
      runtime: 'claude',
      model: 'claude-opus-4-8',
      sourceRuntime: 'policy',
      sourceModel: 'policy',
    });
    const scout = resolveRouting(meta(), 'scout', 'T1', POLICY, EMPTY_OVERRIDE);
    expect([scout.runtime, scout.model]).toEqual(['claude', 'claude-haiku-4-5']);
    expect(scout.sourceRuntime).toBe('policy');
    expect(scout.sourceModel).toBe('policy');
  });

  it('test_policy_star_tier_fallback — manage "*" resolves for every tier', () => {
    for (const tier of ['T1', 'T2', 'T3']) {
      const r = resolveRouting(meta(), 'manage', tier, POLICY, EMPTY_OVERRIDE);
      expect([r.runtime, r.model]).toEqual(['claude', 'claude-opus-4-8']);
    }
  });

  it('test_role_default_when_role_absent_from_policy', () => {
    const r = resolveRouting(meta(), 'some-future-role', 'T2', POLICY, EMPTY_OVERRIDE);
    expect([r.runtime, r.model]).toEqual(['claude', 'claude-sonnet-5']);
    expect(r.sourceRuntime).toBe('policy');
    expect(r.sourceModel).toBe('policy');
  });
});

describe('parity: card frontmatter rung (top precedence)', () => {
  it('test_card_frontmatter_outranks_everything — card > override > policy', () => {
    const override = ov(`version: 1
overrides:
  - scope: agent
    key: worker-desktop
    runtime: claude
    model: claude-sonnet-5
`);
    const r = resolveRouting(meta({ runtime: 'codex', model: 'gpt-5-codex' }), 'work', 'T3', POLICY, override);
    expect([r.runtime, r.model]).toEqual(['codex', 'gpt-5-codex']);
    expect(r.sourceRuntime).toBe('card');
    expect(r.sourceModel).toBe('card');
  });
});

describe('parity: override rung', () => {
  it('test_override_card_scope_beats_agent_scope', () => {
    const override = ov(`version: 1
overrides:
  - scope: agent
    key: worker-desktop
    runtime: claude
    model: claude-sonnet-5
  - scope: card
    key: card-1
    runtime: codex
    model: gpt-5-codex
`);
    const r = resolveRouting(meta(), 'work', 'T3', POLICY, override);
    expect([r.runtime, r.model]).toEqual(['codex', 'gpt-5-codex']);
    expect(r.sourceRuntime).toBe('override');
    expect(r.sourceModel).toBe('override');
  });

  it('test_override_beats_policy_but_not_card', () => {
    const override = ov(`version: 1
overrides:
  - scope: card
    key: card-1
    runtime: claude
    model: claude-haiku-4-5
`);
    const r = resolveRouting(meta(), 'work', 'T3', POLICY, override);
    expect([r.runtime, r.model]).toEqual(['claude', 'claude-haiku-4-5']);
    expect(r.sourceModel).toBe('override');

    const r2 = resolveRouting(meta({ model: 'claude-opus-4-8' }), 'work', 'T3', POLICY, override);
    expect(r2.model).toBe('claude-opus-4-8');
    expect(r2.sourceModel).toBe('card');
  });

  it('test_partial_override_model_only_keeps_policy_runtime — field-by-field provenance', () => {
    const override = ov(`version: 1
overrides:
  - scope: card
    key: card-1
    model: claude-haiku-4-5
`);
    const r = resolveRouting(meta(), 'work', 'T3', POLICY, override);
    expect(r.model).toBe('claude-haiku-4-5');
    expect(r.sourceModel).toBe('override');
    expect(r.runtime).toBe('claude');
    expect(r.sourceRuntime).toBe('policy');
  });

  it('test_expired_override_entry_ignored', () => {
    const override = ov(`version: 1
overrides:
  - scope: card
    key: card-1
    runtime: codex
    model: gpt-5-codex
    expires: 2000-01-01T00:00:00Z
`);
    const r = resolveRouting(meta(), 'work', 'T3', POLICY, override);
    expect([r.runtime, r.model]).toEqual(['claude', 'claude-opus-4-8']);
    expect(r.sourceModel).toBe('policy');
  });

  it('test_future_override_entry_still_applies', () => {
    const override = ov(`version: 1
overrides:
  - scope: card
    key: card-1
    model: claude-haiku-4-5
    expires: 2999-01-01T00:00:00Z
`);
    const r = resolveRouting(meta(), 'work', 'T3', POLICY, override);
    expect(r.model).toBe('claude-haiku-4-5');
    expect(r.sourceModel).toBe('override');
  });

  it('test_last_wins_same_scope_and_key', () => {
    const override = ov(`version: 1
overrides:
  - scope: card
    key: card-1
    model: claude-haiku-4-5
  - scope: card
    key: card-1
    model: claude-opus-4-8
`);
    const r = resolveRouting(meta(), 'work', 'T1', POLICY, override);
    expect(r.model).toBe('claude-opus-4-8');
  });
});

describe('parity: fail-loud / fail-open', () => {
  it('test_unknown_model_raises_routing_error', () => {
    expect(() =>
      resolveRouting(meta({ runtime: 'claude', model: 'claude-ultra-9' }), 'work', 'T3', POLICY, EMPTY_OVERRIDE),
    ).toThrow(RoutingError);
  });

  it('test_corrupt/empty override falls back to policy', () => {
    const r = resolveRouting(meta(), 'work', 'T3', POLICY, { overrides: [] });
    expect([r.runtime, r.model]).toEqual(['claude', 'claude-opus-4-8']);
    expect(r.sourceModel).toBe('policy');
  });

  it('test_missing_policy_uses_safe_default', () => {
    const r = resolveRouting(meta(), 'work', 'T3', {}, { overrides: [] });
    expect([r.runtime, r.model]).toEqual([...SAFE_DEFAULT]);
    expect(r.sourceRuntime).toBe('default');
    expect(r.sourceModel).toBe('default');
  });

  it('test_safe_default_never_raises_without_registry', () => {
    expect(() => resolveRouting(meta(), 'work', 'T3', {}, { overrides: [] })).not.toThrow();
  });
});

describe('parity: registry helpers', () => {
  it('test_owner_runtime_registry_lookup', () => {
    expect(defaultWorkerFor(POLICY, 'claude')).toBe('worker-desktop');
    expect(defaultWorkerFor(POLICY, 'codex')).toBe('codex-worker');
    expect(defaultWorkerFor(POLICY, 'gemini')).toBeNull();
    expect(defaultWorkerFor({}, 'claude')).toBeNull();
  });

  it('test_runtime_of_worker_reverse_lookup', () => {
    expect(runtimeOfWorker(POLICY, 'codex-worker')).toBe('codex');
    expect(runtimeOfWorker(POLICY, 'worker-desktop')).toBe('claude');
    expect(runtimeOfWorker(POLICY, 'dispatcher-cloud')).toBeNull();
  });
});

describe('effectiveForCard / effectiveForAgent wrappers', () => {
  it('effectiveForCard reads the card own role + risk-tier', () => {
    const r = effectiveForCard({ id: 'c', owner: 'w', role: 'work', 'risk-tier': 'T3' }, POLICY, EMPTY_OVERRIDE);
    expect([r.runtime, r.model, r.sourceModel]).toEqual(['claude', 'claude-opus-4-8', 'policy']);
  });

  it('effectiveForCard on a legacy card (no role) falls to role_default', () => {
    const r = effectiveForCard({ id: 'c', owner: 'w' }, POLICY, EMPTY_OVERRIDE);
    expect([r.runtime, r.model]).toEqual(['claude', 'claude-sonnet-5']);
  });

  it('effectiveForAgent reports source=override when an agent-scope entry matches', () => {
    const override = ov(`version: 1
overrides:
  - scope: agent
    key: worker-desktop
    runtime: codex
    model: gpt-5-codex
`);
    const r = effectiveForAgent('worker-desktop', POLICY, override);
    expect([r.runtime, r.model, r.sourceRuntime]).toEqual(['codex', 'gpt-5-codex', 'override']);
  });

  it('effectiveForAgent with no override falls to policy role_default (source=policy)', () => {
    const r = effectiveForAgent('worker-desktop', POLICY, EMPTY_OVERRIDE);
    expect([r.runtime, r.model, r.sourceModel]).toEqual(['claude', 'claude-sonnet-5', 'policy']);
  });

  it('effectiveForAgent with absent policy falls to the safe default (source=default)', () => {
    const r = effectiveForAgent('anyone', {}, EMPTY_OVERRIDE);
    expect([r.runtime, r.model, r.sourceRuntime]).toEqual([...SAFE_DEFAULT, 'default']);
  });
});

/**
 * The agent-side precedence, rung by rung. Before this suite every agent resolved `role_default` because
 * the wrapper hard-coded role='' AND discarded the agent's own declared runtime/model.
 */
describe('effectiveForAgent precedence: declaration > override > policy[role] > SAFE_DEFAULT', () => {
  it('rung 1 — the agent DECLARATION wins over its role row (source=card, its own frontmatter)', () => {
    const r = effectiveForAgent('boss', POLICY, EMPTY_OVERRIDE, {
      role: 'manage',
      runtime: 'codex',
      model: 'gpt-5-codex',
    });
    // `manage` would give claude/opus; the agent's own declaration outranks it.
    expect(r).toEqual({ runtime: 'codex', model: 'gpt-5-codex', sourceRuntime: 'card', sourceModel: 'card' });
  });

  it('rung 2 — a scope:agent override outranks the declaration ONLY where the declaration is silent', () => {
    const override = ov(`version: 1
overrides:
  - scope: agent
    key: half-declared
    runtime: codex
    model: gpt-5-codex
`);
    // Declares a runtime but no model: runtime stays the declaration's, the model comes from the override.
    const r = effectiveForAgent('half-declared', POLICY, override, { role: 'manage', runtime: 'codex', model: null });
    expect([r.runtime, r.sourceRuntime, r.model, r.sourceModel]).toEqual(['codex', 'card', 'gpt-5-codex', 'override']);
    // Fully declared: the declaration wins both fields outright.
    const declared = effectiveForAgent('half-declared', POLICY, override, {
      role: 'manage',
      runtime: 'claude',
      model: 'claude-opus-4-8',
    });
    expect([declared.model, declared.sourceModel]).toEqual(['claude-opus-4-8', 'card']);
  });

  it('rung 3 — with no declared model the DECLARED ROLE selects the policy row (manage -> opus)', () => {
    const r = effectiveForAgent('mgr', POLICY, EMPTY_OVERRIDE, { role: 'manage', runtime: null, model: null });
    expect(r).toEqual({
      runtime: 'claude',
      model: 'claude-opus-4-8',
      sourceRuntime: 'policy',
      sourceModel: 'policy',
    });
    const scout = effectiveForAgent('sc', POLICY, EMPTY_OVERRIDE, { role: 'scout', runtime: null, model: null });
    expect([scout.model, scout.sourceModel]).toEqual(['claude-haiku-4-5', 'policy']);
  });

  it('rung 3 — a role whose row is tier-keyed only (work) falls to role_default: an agent has no tier', () => {
    // `work` declares T1/T2/T3 and no "*" cell, and an agent carries no risk tier, so `policyCell` finds
    // no cell and falls to role_default. No tier is invented on the agent's behalf.
    const r = effectiveForAgent('w', POLICY, EMPTY_OVERRIDE, { role: 'work', runtime: null, model: null });
    expect([r.runtime, r.model, r.sourceModel]).toEqual(['claude', 'claude-sonnet-5', 'policy']);
  });

  it('rung 3 — an unknown role also falls to role_default (source stays policy)', () => {
    const r = effectiveForAgent('x', POLICY, EMPTY_OVERRIDE, { role: 'some-future-role', runtime: null, model: null });
    expect([r.model, r.sourceModel]).toEqual(['claude-sonnet-5', 'policy']);
  });

  it('rung 4 — no declaration and no readable policy is the ONLY path to SAFE_DEFAULT', () => {
    const r = effectiveForAgent('x', {}, EMPTY_OVERRIDE, { role: 'manage', runtime: null, model: null });
    expect([r.runtime, r.model, r.sourceRuntime, r.sourceModel]).toEqual([...SAFE_DEFAULT, 'default', 'default']);
  });

  it('a declaration naming a model its runtime does not know fails LOUD (parity with dispatch)', () => {
    expect(() =>
      effectiveForAgent('x', POLICY, EMPTY_OVERRIDE, { role: 'work', runtime: 'claude', model: 'gpt-5-codex' }),
    ).toThrow(RoutingError);
  });

  it('an omitted declaration is exactly the pre-declaration behaviour (role_default)', () => {
    expect(effectiveForAgent('x', POLICY, EMPTY_OVERRIDE)).toEqual(
      effectiveForAgent('x', POLICY, EMPTY_OVERRIDE, null),
    );
  });
});
