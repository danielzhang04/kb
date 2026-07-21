/**
 * U4 — command-palette model. The command set derives from the nav config (navigate) plus the fixed act
 * shortcuts; the filter is a substring/subsequence match. No governed endpoint is ever encoded here — an
 * act command only names a destination to navigate to (or the focus-floor intent).
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_COMMANDS,
  ACT_COMMANDS,
  NAVIGATE_COMMANDS,
  filterCommands,
} from './paletteModel';

describe('paletteModel — command set', () => {
  it('has one navigate command per nav destination, actionable for live destinations', () => {
    const byId = new Map(NAVIGATE_COMMANDS.map((c) => [c.target, c]));
    // Live destinations are actionable…
    expect(byId.get('workflows')?.disabled).toBe(false);
    expect(byId.get('home')?.disabled).toBe(false);
    // Atlas went live in Atlas V1 (promoted from the greyed "soon" stub) — actionable, no greyed hint.
    expect(byId.get('atlas')?.disabled).toBe(false);
    expect(byId.get('atlas')?.hint).toBeUndefined();
    // Terminal went live in D3.2 — actionable, no greyed hint.
    expect(byId.get('terminal')?.disabled).toBe(false);
    expect(byId.get('terminal')?.hint).toBeUndefined();
  });

  it('act commands are shortcuts to a governed SURFACE, never an endpoint', () => {
    // Every act command is actionable and routes to a surface (target) or focuses the floor — and
    // carries no endpoint/url/method field of any kind.
    for (const cmd of ACT_COMMANDS) {
      expect(cmd.disabled).toBe(false);
      expect(Boolean(cmd.target) || cmd.focusFloor === true).toBe(true);
      expect('url' in cmd).toBe(false);
      expect('endpoint' in cmd).toBe(false);
      expect('method' in cmd).toBe(false);
    }
    expect(ACT_COMMANDS.find((c) => c.id === 'act:approve')?.target).toBe('approvals');
    expect(ACT_COMMANDS.find((c) => c.id === 'act:launch')?.target).toBe('home');
    expect(ACT_COMMANDS.find((c) => c.id === 'act:stop')?.focusFloor).toBe(true);
  });
});

describe('paletteModel — filter', () => {
  it('returns everything for an empty query', () => {
    expect(filterCommands(ALL_COMMANDS, '')).toHaveLength(ALL_COMMANDS.length);
    expect(filterCommands(ALL_COMMANDS, '   ')).toHaveLength(ALL_COMMANDS.length);
  });

  it('narrows the set to matches and keeps the target destination', () => {
    const res = filterCommands(ALL_COMMANDS, 'workflows');
    expect(res.length).toBeLessThan(ALL_COMMANDS.length);
    expect(res.some((c) => c.target === 'workflows')).toBe(true);
    expect(res.some((c) => c.target === 'home')).toBe(false);
  });

  it('matches on keywords, and returns none for a miss', () => {
    // "passkey" is a keyword of the stop shortcut; the filter surfaces it via its keywords.
    const stop = filterCommands(ALL_COMMANDS, 'passkey');
    expect(stop.some((c) => c.id === 'act:stop')).toBe(true);
    expect(filterCommands(ALL_COMMANDS, 'zzzzq')).toHaveLength(0);
  });
});
