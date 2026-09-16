import { describe, expect, it } from 'vitest';
import { FORBIDDEN_WORKFLOW_TOOLS, loadWorkflowProfiles, workflowProfileIds } from '../control/environment.ts';
import { ToolPolicyRefusal, createWorkflowToolPolicyResolver } from '../control/claudeLaunchPolicy.ts';
import { buildWorkflowPolicyTable } from '../pty/fdPinnedPaths.ts';
import { codexSandboxMode, toolCapArgv } from '../control/workflowProfiles.ts';

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

  /**
   * 2026-09-16 post-launch fix #2. `research` shipped without `Write` while every definition that
   * declares it orders the worker to write one file, so the cap and the work order contradicted each
   * other and only a REAL claude showed it: `--tools` has no Write, the child answers
   * `Error: No such tool available: Write. Write is disabled for this session`, and the stage dies.
   * (Prod canary run-1328b419, 2026-09-16 08:57Z; every rehearsal passed because the stub `claude`
   * wrote its files directly and never consulted the cap.) This pins the whole list, not just the
   * presence of Write, so the next edit to this profile has to be deliberate.
   */
  it('gives the research profile the Write its own work orders require, and nothing forbidden', () => {
    const research = loadWorkflowProfiles().find((profile) => profile.id === 'research');
    expect(research).toBeDefined();
    expect(research!.allowedTools).toEqual(['WebSearch', 'WebFetch', 'Read', 'Glob', 'Grep', 'Write']);
    expect(research!.allowedTools).toContain('Write');
    // The grant is a WRITE, not an escalation: no shell, no in-place edit of anything it did not author.
    expect(research!.allowedTools).not.toContain('Bash');
    expect(research!.allowedTools).not.toContain('Edit');
    for (const forbidden of FORBIDDEN_WORKFLOW_TOOLS) {
      expect(research!.allowedTools).not.toContain(forbidden);
    }
    // The cap that actually reaches the child carries Write too — a profile entry the `--tools` argv
    // dropped would be the same defect wearing a different hat.
    expect(toolCapArgv(research!.allowedTools)).toEqual([
      '--tools', 'WebSearch,WebFetch,Read,Glob,Grep,Write', '--strict-mcp-config',
    ]);
    // ...and the codex half of the same cap moves with it, deliberately: codex takes no --allowedTools,
    // so `read-only` would have left a codex research worker unable to write its brief for a second,
    // unrelated reason. Network is pinned off for codex regardless (CODEX_CONFIGURATION_PINS).
    expect(codexSandboxMode(research!.allowedTools)).toBe('workspace-write');
  });
});
