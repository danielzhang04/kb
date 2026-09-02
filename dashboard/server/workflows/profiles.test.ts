import { describe, expect, it } from 'vitest';
import { FORBIDDEN_WORKFLOW_TOOLS, loadWorkflowProfiles, workflowProfileIds } from '../control/environment.ts';
import { ToolPolicyRefusal, createWorkflowToolPolicyResolver } from '../control/claudeLaunchPolicy.ts';
import { buildWorkflowPolicyTable } from '../pty/fdPinnedPaths.ts';

describe('workflow execution profiles', () => {
  it('exposes every server-owned profile the shipped definitions reference, including the readonly checker and C1 scanner', () => {
    expect(workflowProfileIds()).toEqual(new Set(['checker-readonly', 'research', 'gmail-triage', 'drive-author', 'producer', 'scanner']));
  });

  it('gives the scanner profile exactly Read/Glob/Grep/Write — no Bash, no Edit (removes the git bypass)', () => {
    const scanner = loadWorkflowProfiles().find((profile) => profile.id === 'scanner');
    expect(scanner).toBeDefined();
    expect(scanner!.allowedTools).toEqual(['Read', 'Glob', 'Grep', 'Write']);
    expect(scanner!.allowedTools).not.toContain('Bash');
    expect(scanner!.allowedTools).not.toContain('Edit');
  });

  it('never grants a publish/send capability in any default profile', () => {
    for (const profile of loadWorkflowProfiles()) {
      for (const forbidden of FORBIDDEN_WORKFLOW_TOOLS) {
        expect(profile.allowedTools).not.toContain(forbidden);
      }
      // Defense in depth: no tool name that looks like an external send/upload/publish sneaks in.
      for (const tool of profile.allowedTools) {
        expect(tool).not.toMatch(/upload_video|send_email|gmail_send|send_message/i);
      }
    }
  });

  /**
   * The broker cannot import the control plane (its payload is a compiled leaf bundle), so it carries
   * its own copy of the malformed/forbidden filters. Two copies is a licence to drift, so both are
   * held to the same verdict on the same inputs here.
   */
  it('makes the broker table and the control-plane resolver agree on which profiles are launchable', () => {
    const profiles = loadWorkflowProfiles();
    const resolve = createWorkflowToolPolicyResolver({ profiles });
    for (const profile of profiles) {
      expect(resolve(profile.id).allowedTools).toEqual([...profile.allowedTools]);
      expect(buildWorkflowPolicyTable(profiles).get(profile.id)!.allowedTools).toEqual(profile.allowedTools);
    }
    for (const bad of [
      { id: 'bad', allowedTools: ['Read', 'upload_video'] },
      { id: 'bad', allowedTools: ['Read,Write'] },
      { id: 'bad', allowedTools: ['--dangerously-skip-permissions'] },
      { id: 'bad', allowedTools: [] },
    ]) {
      expect(() => createWorkflowToolPolicyResolver({ profiles: [bad] })('bad')).toThrow(ToolPolicyRefusal);
      expect(() => buildWorkflowPolicyTable([bad])).toThrow();
    }
  });

  it('gives the research profile web reach and the gmail-triage profile a draft (not send) tool', () => {
    const profiles = new Map(loadWorkflowProfiles().map((profile) => [profile.id, profile.allowedTools]));
    expect(profiles.get('research')).toEqual(expect.arrayContaining(['WebSearch', 'WebFetch']));
    expect(profiles.get('gmail-triage')).toEqual(expect.arrayContaining(['mcp__google-workspace__draft_gmail_message']));
  });
});
