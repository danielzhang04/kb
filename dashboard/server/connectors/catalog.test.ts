import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_WORKFLOW_TOOLS,
  loadWorkflowProfiles,
} from '../control/environment.ts';
import {
  EXTERNAL_CONNECTORS,
  allRequiredGates,
  connectorForProfile,
  knownMcpToolPrefixes,
} from './catalog.ts';

/**
 * These tests are the whole point of the catalog: they turn "a profile names an unregistered server"
 * and "a send/publish tool sneaked into a connector" into failures at `npm test`, not at runtime.
 * They cross-check the catalog against the REAL environment.ts so the two files must stay consistent.
 */
describe('external connector catalog', () => {
  it('is frozen closed data', () => {
    expect(Object.isFrozen(EXTERNAL_CONNECTORS)).toBe(true);
  });

  it('covers every mcp__ tool named in any workflow profile (no orphan tools)', () => {
    const prefixes = knownMcpToolPrefixes();
    for (const profile of loadWorkflowProfiles()) {
      for (const tool of profile.allowedTools) {
        if (!tool.startsWith('mcp__')) continue; // local tools (Read/Write/WebSearch/...) need no connector
        const covered = prefixes.some((prefix) => tool.startsWith(prefix));
        expect(covered, `tool ${tool} in profile ${profile.id} has no catalogued connector`).toBe(true);
      }
    }
  });

  /**
   * A connector handle is a WHOLE-SERVER prefix, so it necessarily covers that server's send/publish
   * tools too — the google-workspace server can send mail; we simply never grant the tool. The
   * connector layer therefore cannot enforce the ban, and asserting it could would be a false comfort.
   * The enforceable invariant is the one below: wherever a connector is reachable at all, every profile
   * it serves must exclude that connector's forbidden tools.
   */
  it('grants no forbidden tool through any profile a connector serves', () => {
    const profiles = new Map(loadWorkflowProfiles().map((profile) => [profile.id, profile.allowedTools]));
    for (const connector of EXTERNAL_CONNECTORS) {
      const reachable = FORBIDDEN_WORKFLOW_TOOLS.filter((tool) => tool.startsWith(connector.handle));
      for (const profileId of connector.serves) {
        const allowed = profiles.get(profileId);
        if (!allowed) continue; // profile not shipped yet (calendar-read / meeting-notes — IR-2)
        for (const forbidden of reachable) {
          expect(allowed, `${profileId} must not grant ${forbidden}`).not.toContain(forbidden);
        }
        expect(allowed.join(',')).not.toMatch(/upload_video|send_email|gmail_send|send_message/i);
      }
    }
  });

  it('routes each external profile to exactly one connector, and local profiles to none', () => {
    expect(connectorForProfile('gmail-triage')?.id).toBe('google-workspace');
    expect(connectorForProfile('drive-author')?.id).toBe('google-workspace');
    expect(connectorForProfile('research')).toBeNull(); // WebSearch/WebFetch are built-in, not a connector
  });

  it('requires G1 (the GCP root gate) for every Google-backed connector', () => {
    const g1 = '6a5d6b23-12ddfee2';
    for (const connector of EXTERNAL_CONNECTORS) {
      expect(connector.requiredGates).toContain(g1);
    }
    expect(allRequiredGates()).toContain(g1);
  });

  it('keeps youtube-uploader (publish) out of every workflow profile', () => {
    const uploader = EXTERNAL_CONNECTORS.find((connector) => connector.id === 'youtube-uploader');
    expect(uploader?.serves).toEqual([]);
  });
});
