/**
 * U4 — command-palette model. The command set derives from the nav config (navigate) plus the fixed act
 * shortcuts; the filter is a substring/subsequence match. No governed endpoint is ever encoded here — an
 * act command only names a destination to navigate to.
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
    // Every act command is actionable and NAMES A DESTINATION — and carries no endpoint/url/method
    // field of any kind. Running one is a navigation, nothing more.
    for (const cmd of ACT_COMMANDS) {
      expect(cmd.disabled).toBe(false);
      expect(Boolean(cmd.target)).toBe(true);
      expect('url' in cmd).toBe(false);
      expect('endpoint' in cmd).toBe(false);
      expect('method' in cmd).toBe(false);
      // The pinned Session/Stop floor is gone (spec §6): no command focuses a shell region any more.
      expect('focusFloor' in cmd).toBe(false);
    }
    expect(ACT_COMMANDS.find((c) => c.id === 'act:approve')?.target).toBe('approvals');
    // The launch shortcut follows the ONE Launch button, which lives on the workflow surface now.
    expect(ACT_COMMANDS.find((c) => c.id === 'act:launch')?.target).toBe('workflows');
    // …and the stop shortcut follows the stop controls, which live on the Sentinel view now.
    expect(ACT_COMMANDS.find((c) => c.id === 'act:stop')?.target).toBe('sentinel');
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
    // "nuclear" is a keyword of the stop shortcut; the filter surfaces it via its keywords.
    const stop = filterCommands(ALL_COMMANDS, 'nuclear');
    expect(stop.some((c) => c.id === 'act:stop')).toBe(true);
    expect(filterCommands(ALL_COMMANDS, 'zzzzq')).toHaveLength(0);
  });
});
