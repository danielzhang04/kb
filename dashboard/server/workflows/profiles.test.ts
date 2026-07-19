import { describe, expect, it } from 'vitest';
import { FORBIDDEN_WORKFLOW_TOOLS, loadWorkflowProfiles, workflowProfileIds } from '../control/environment.ts';

describe('workflow execution profiles', () => {
  it('exposes the four server-owned profiles the shipped definitions reference', () => {
    expect(workflowProfileIds()).toEqual(new Set(['research', 'gmail-triage', 'drive-author', 'producer']));
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

  it('gives the research profile web reach and the gmail-triage profile a draft (not send) tool', () => {
    const profiles = new Map(loadWorkflowProfiles().map((profile) => [profile.id, profile.allowedTools]));
    expect(profiles.get('research')).toEqual(expect.arrayContaining(['WebSearch', 'WebFetch']));
    expect(profiles.get('gmail-triage')).toEqual(expect.arrayContaining(['mcp__google-workspace__draft_gmail_message']));
  });
});
