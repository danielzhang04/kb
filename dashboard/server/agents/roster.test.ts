import { describe, it, expect } from 'vitest';
import { parseYaml } from '../routing/yaml.ts';
import type { PolicyDoc, OverrideDoc } from '../routing/policy.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';
import type { ParsedCard } from '../planeA/cards.ts';
import { listAgents } from './roster.ts';

const POLICY = parseYaml(`version: 1
runtimes:
  claude:
    default_worker: worker-desktop
    aliases: { opus: claude-opus-4-8, sonnet: claude-sonnet-5, haiku: claude-haiku-4-5 }
    known_models: [claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5]
  codex:
    default_worker: codex-worker
    aliases: { codex: gpt-5-codex }
    known_models: [gpt-5-codex]
policy:
  work:
    T3: { runtime: claude, model: opus }
role_default: { runtime: claude, model: sonnet }
`) as PolicyDoc;

function card(meta: Record<string, unknown>): ParsedCard {
  return { meta: meta as ParsedCard['meta'], body: '' };
}

function indexOf(cards: ParsedCard[]): PlaneAIndex {
  const byState: Record<string, ParsedCard[]> = {};
  for (const c of cards) (byState[String(c.meta.state)] ??= []).push(c);
  return { cards: byState, ledgers: {} as PlaneAIndex['ledgers'], orgStates: [] };
}

describe('listAgents', () => {
  it('lists each agent with effective runtime+model and source (R2.2)', () => {
    const index = indexOf([
      card({ id: 'a1', owner: 'worker-desktop', state: 'working', action: 'build', project: 'kb' }),
      card({ id: 'a2', owner: 'worker-desktop', state: 'done', action: 'x', project: 'kb' }),
      card({ id: 'b1', owner: 'codex-worker', state: 'inbox', action: 'y', project: 'atlas' }),
    ]);
    const rows = listAgents(index, POLICY, { overrides: [] });
    expect(rows.map((r) => r.id)).toEqual(['worker-desktop', 'codex-worker']); // working-first

    const wd = rows.find((r) => r.id === 'worker-desktop')!;
    expect(wd.working).toBe(true);
    expect(wd.cardCount).toBe(2);
    // No override -> policy role_default (source policy).
    expect([wd.effective.runtime, wd.effective.model, wd.effective.sourceModel]).toEqual([
      'claude',
      'claude-sonnet-5',
      'policy',
    ]);
  });

  it('reflects an agent-scope override in the agent effective (source=override)', () => {
    const override: OverrideDoc = parseYaml(`version: 1
overrides:
  - scope: agent
    key: codex-worker
    runtime: codex
    model: gpt-5-codex
`) as unknown as OverrideDoc;
    const index = indexOf([card({ id: 'b1', owner: 'codex-worker', state: 'inbox', action: 'y', project: 'atlas' })]);
    const row = listAgents(index, POLICY, override)[0];
    expect([row.effective.runtime, row.effective.model, row.effective.sourceRuntime]).toEqual([
      'codex',
      'gpt-5-codex',
      'override',
    ]);
  });

  it('is empty-safe with no cards', () => {
    expect(listAgents(indexOf([]), POLICY, { overrides: [] })).toEqual([]);
  });
});
