import { describe, expect, it } from 'vitest';
import {
  MAX_COMPOSER_PLANNING_INSTRUCTION_CHARS,
  withComposerPlanningInstruction,
} from './planningInstruction.ts';

describe('server-owned Composer planning protocol', () => {
  it('is bounded, conditional, closed-schema, and includes every executable governance anchor', () => {
    const operator = 'Keep brainstorming; the plan is not ready.';
    const governed = withComposerPlanningInstruction(operator);
    const instructionLength = governed.length - operator.length - 2;

    expect(governed.startsWith(`${operator}\n\n`)).toBe(true);
    expect(instructionLength).toBeGreaterThan(0);
    expect(instructionLength).toBeLessThanOrEqual(MAX_COMPOSER_PLANNING_INSTRUCTION_CHARS);
    expect(governed).toContain('Do not emit a proposal merely because this instruction is present');
    expect(governed).toContain('exactly one closed fenced block');
    expect(governed).toContain('kb.plan-proposal/v1');
    expect(governed).toContain('CLAUDE.md');
    expect(governed).toContain('governance/agent-rules.md');
    expect(governed).toContain('governance/risk-tiers.md');
    expect(governed).toContain('orgs/<project>/contract.md');
    expect(governed).toContain('permission bypasses');
    expect(governed).toContain('environment variables');
  });
});

