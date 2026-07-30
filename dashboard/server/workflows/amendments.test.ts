import { describe, expect, it } from 'vitest';
import {
  isExactAssignmentAmendment,
  isExactGovernanceAmendment,
  patchWorkflowAssignment,
  patchWorkflowGovernance,
} from './amendments.ts';
import { parseWorkflowDef } from './defs.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VIDEO_RUN = [
  '---',
  'id: video-run',
  'project: faceless-youtube',
  'title: Video run',
  'profile: producer',
  'stages:',
  '  - id: research',
  '    title: Research',
  '    action: research:brief',
  '    target: orgs/faceless-youtube/output',
  '    workOrder: research the video',
  '    dependsOn: []',
  '  - id: script',
  '    title: Script',
  '    action: draft:script',
  '    target: orgs/faceless-youtube/output',
  '    workOrder: write it',
  '    dependsOn: [research]',
  '---',
  '# body comment stays byte-for-byte',
  'body',
  '',
].join('\n');

describe('patchWorkflowAssignment', () => {
  it('adds and clears a stage assignment without touching real inline dependsOn arrays or body bytes', () => {
    const set = patchWorkflowAssignment(VIDEO_RUN, { kind: 'stage', stageId: 'script' }, { agentId: 'writer', profileId: 'worker:claude:claude-sonnet-5' });
    expect(set).not.toBeNull();
    expect(set?.source).toContain('    dependsOn: [research]\n    agentId: writer\n    profileId: worker:claude:claude-sonnet-5\n');
    expect(set?.source.endsWith('---\n# body comment stays byte-for-byte\nbody\n')).toBe(true);
    const cleared = patchWorkflowAssignment(set!.source, { kind: 'stage', stageId: 'script' }, null);
    expect(cleared?.source).toBe(VIDEO_RUN);
  });

  it('preserves CRLF and unrelated comments while narrowly replacing a manager mapping', () => {
    const source = ['---', 'id: example', 'project: faceless-youtube', 'title: Example', 'profile: producer', '# keep this comment', 'manager:', '  agentId: old-manager', '  profileId: manager:claude:claude-opus-4-8', 'stages:', '  - id: work', '    title: Work', '    action: research:brief', '    target: orgs/faceless-youtube/output', '    workOrder: work', '---', 'body', ''].join('\r\n');
    const patched = patchWorkflowAssignment(source, { kind: 'manager' }, { agentId: 'new-manager', profileId: 'manager:claude:claude-opus-4-8' });
    expect(patched?.source).toContain('# keep this comment\r\nmanager:\r\n  agentId: new-manager\r\n  profileId: manager:claude:claude-opus-4-8\r\nstages:');
    expect(patched?.source.includes('\n') && !patched?.source.includes('\r\n')).toBe(false);
    expect(patched?.oldAssignment).toEqual({ agentId: 'old-manager', profileId: 'manager:claude:claude-opus-4-8' });
    expect(patchWorkflowAssignment(patched!.source, { kind: 'manager' }, null)?.source).toBe(source.replace('manager:\r\n  agentId: old-manager\r\n  profileId: manager:claude:claude-opus-4-8\r\n', ''));
  });

  it('refuses to replace assignment lines carrying comments, rather than rewriting authored meaning', () => {
    const source = VIDEO_RUN.replace('    dependsOn: [research]', '    agentId: old # deliberate\n    profileId: worker:claude:claude-sonnet-5\n    dependsOn: [research]');
    expect(patchWorkflowAssignment(source, { kind: 'stage', stageId: 'script' }, { agentId: 'next', profileId: 'worker:claude:claude-sonnet-5' })).toBeNull();
  });

  it('refuses unknown stages and a true no-op rather than manufacturing a durable proposal', () => {
    expect(patchWorkflowAssignment(VIDEO_RUN, { kind: 'stage', stageId: 'nope' }, { agentId: 'writer', profileId: 'worker:claude:claude-sonnet-5' })).toBeNull();
    expect(patchWorkflowAssignment(VIDEO_RUN, { kind: 'manager' }, null)?.source).toBe(VIDEO_RUN);
  });

  it('refuses block scalars, commented assignment declarations, and scalar injection', () => {
    const blockScalar = VIDEO_RUN.replace('    workOrder: write it', '    workOrder: |\n      agentId: prose only\n      profileId: prose only');
    expect(patchWorkflowAssignment(blockScalar, { kind: 'stage', stageId: 'script' }, null)).toBeNull();
    const commented = VIDEO_RUN.replace('    dependsOn: [research]', '    # agentId: preserve this authored comment\n    dependsOn: [research]');
    expect(patchWorkflowAssignment(commented, { kind: 'stage', stageId: 'script' }, { agentId: 'writer', profileId: 'worker:claude:claude-sonnet-5' })).toBeNull();
    expect(patchWorkflowAssignment(VIDEO_RUN, { kind: 'stage', stageId: 'script' }, { agentId: 'writer\n    riskTier: T3', profileId: 'worker:claude:claude-sonnet-5' })).toBeNull();
  });

  it('proves the parsed target values as well as every non-target semantic field', () => {
    const semanticSource = VIDEO_RUN.replace('    action: draft:script', '    action: research:brief');
    const patched = patchWorkflowAssignment(semanticSource, { kind: 'stage', stageId: 'script' }, { agentId: 'writer', profileId: 'worker:claude:claude-sonnet-5' });
    const before = parseWorkflowDef(semanticSource); const after = parseWorkflowDef(patched!.source);
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(isExactAssignmentAmendment(before.value, after.value, { kind: 'stage', stageId: 'script' }, { agentId: 'writer', profileId: 'worker:claude:claude-sonnet-5' }, patched!.oldAssignment)).toBe(true);
    const wrongTarget = { ...after.value, stages: after.value.stages.map((stage) => stage.id === 'script' ? { ...stage, agentId: 'other' } : stage) };
    expect(isExactAssignmentAmendment(before.value, wrongTarget, { kind: 'stage', stageId: 'script' }, { agentId: 'writer', profileId: 'worker:claude:claude-sonnet-5' }, patched!.oldAssignment)).toBe(false);
    expect(isExactAssignmentAmendment(before.value, after.value, { kind: 'stage', stageId: 'script' }, { agentId: 'writer', profileId: 'worker:claude:claude-sonnet-5' }, { agentId: 'wrong-old', profileId: 'worker:claude:claude-sonnet-5' })).toBe(false);
  });

  it('handles the committed faceless-youtube video-run definition without altering non-target bytes', () => {
    const path = fileURLToPath(new URL('../../../orgs/faceless-youtube/workflows/video-run.md', import.meta.url));
    const actual = readFileSync(path, 'utf8');
    // The committed definition now assigns every stage, so this exercises REPLACEMENT of an existing
    // pair rather than insertion — the same byte-exactness claim, on the shape that actually ships.
    const patched = patchWorkflowAssignment(actual, { kind: 'stage', stageId: 'idea' }, { agentId: 'writer', profileId: 'worker:claude:claude-sonnet-5' });
    expect(patched).not.toBeNull();
    expect(patched!.oldAssignment).toEqual({ agentId: 'fyt-story', profileId: 'worker:claude:claude-fable-5' });
    expect(patched!.source.replace(
      /    agentId: writer(\r?\n)    profileId: worker:claude:claude-sonnet-5(\r?\n)/,
      '    agentId: fyt-story$1    profileId: worker:claude:claude-fable-5$2',
    )).toBe(actual);
  });
});

describe('patchWorkflowGovernance', () => {
  const OWNED = {
    workflow: 'fyt-runner',
    stages: { research: 'fyt-preproduction', script: 'fyt-checker' },
  };

  it('adds and clears one complete governance snapshot without changing any other byte', () => {
    const patched = patchWorkflowGovernance(VIDEO_RUN, OWNED);
    expect(patched).not.toBeNull();
    expect(patched?.oldGovernance).toEqual({
      workflow: null,
      stages: { research: null, script: null },
    });
    expect(patched?.source).toContain('profile: producer\ngovernedBy: fyt-runner\nstages:');
    expect(patched?.source).toContain('  - id: research\n    governedBy: fyt-preproduction\n');
    expect(patched?.source).toContain('  - id: script\n    governedBy: fyt-checker\n');
    expect(patched?.source.endsWith('---\n# body comment stays byte-for-byte\nbody\n')).toBe(true);
    expect(patchWorkflowGovernance(patched!.source, {
      workflow: null,
      stages: { research: null, script: null },
    })?.source).toBe(VIDEO_RUN);
  });

  it('preserves CRLF and unrelated comments while replacing existing ownership', () => {
    const source = VIDEO_RUN
      .replace('profile: producer', 'profile: producer\n# workflow comment\ngovernedBy: old-runner')
      .replace('  - id: research', '  - id: research\n    governedBy: old-worker')
      .replace(/\n/g, '\r\n');
    const patched = patchWorkflowGovernance(source, {
      workflow: 'new-runner',
      stages: { research: 'new-worker', script: null },
    });
    expect(patched?.oldGovernance).toEqual({
      workflow: 'old-runner',
      stages: { research: 'old-worker', script: null },
    });
    expect(patched?.source).toContain('# workflow comment\r\ngovernedBy: new-runner\r\nstages:');
    expect(patched?.source).toContain('  - id: research\r\n    governedBy: new-worker\r\n');
    expect(patched?.source.replace(/\r\n/g, '')).not.toContain('\n');
    expect(patched?.source.endsWith('---\r\n# body comment stays byte-for-byte\r\nbody\r\n')).toBe(true);
  });

  it('requires the exact closed stage snapshot and rejects unsafe ownership values', () => {
    expect(patchWorkflowGovernance(VIDEO_RUN, {
      workflow: 'fyt-runner',
      stages: { research: 'fyt-preproduction' },
    })).toBeNull();
    expect(patchWorkflowGovernance(VIDEO_RUN, {
      workflow: 'fyt-runner',
      stages: { research: 'fyt-preproduction', script: 'fyt-checker', extra: null },
    })).toBeNull();
    expect(patchWorkflowGovernance(VIDEO_RUN, {
      workflow: '../runner',
      stages: { research: null, script: null },
    })).toBeNull();
    expect(patchWorkflowGovernance(VIDEO_RUN, {
      workflow: null,
      stages: { research: 'bad\n    riskTier: T3', script: null },
    })).toBeNull();
  });

  it('normalizes safe JSON-quoted owners but refuses comments, duplicates, and ambiguous layouts', () => {
    const commented = VIDEO_RUN.replace('profile: producer', 'profile: producer\n# governedBy: preserve-this');
    expect(patchWorkflowGovernance(commented, OWNED)).toBeNull();
    const stageComment = VIDEO_RUN.replace('  - id: script', '  - id: script\n    # governedBy: preserve-this');
    expect(patchWorkflowGovernance(stageComment, OWNED)).toBeNull();
    const duplicate = VIDEO_RUN.replace('profile: producer', 'profile: producer\ngovernedBy: first\ngovernedBy: second');
    expect(patchWorkflowGovernance(duplicate, OWNED)).toBeNull();
    const quoted = VIDEO_RUN
      .replace('profile: producer', 'profile: producer\ngovernedBy: "old-runner"')
      .replace('  - id: research', '  - id: research\n    governedBy: "old-worker"');
    const normalized = patchWorkflowGovernance(quoted, OWNED);
    expect(normalized?.oldGovernance).toEqual({ workflow: 'old-runner', stages: { research: 'old-worker', script: null } });
    expect(normalized?.source).toContain('governedBy: fyt-runner');
    expect(normalized?.source).toContain('    governedBy: fyt-preproduction');
    const scalar = VIDEO_RUN.replace('profile: producer', 'profile: producer\ngovernedBy: |\n  prose-owner');
    expect(patchWorkflowGovernance(scalar, OWNED)).toBeNull();
  });

  it('proves the old/new ownership snapshot and rejects every non-governance semantic change', () => {
    const patched = patchWorkflowGovernance(VIDEO_RUN, OWNED);
    const before = parseWorkflowDef(VIDEO_RUN);
    const after = parseWorkflowDef(patched!.source);
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(isExactGovernanceAmendment(before.value, after.value, OWNED, patched!.oldGovernance)).toBe(true);
    expect(isExactGovernanceAmendment(before.value, after.value, OWNED, {
      workflow: 'wrong-old',
      stages: { research: null, script: null },
    })).toBe(false);
    const changedAction = {
      ...after.value,
      stages: after.value.stages.map((stage) => (
        stage.id === 'script' ? { ...stage, action: 'research:changed' } : stage
      )),
    };
    expect(isExactGovernanceAmendment(before.value, changedAction, OWNED, patched!.oldGovernance)).toBe(false);
    const changedOwner = {
      ...after.value,
      stages: after.value.stages.map((stage) => (
        stage.id === 'script' ? { ...stage, governedBy: 'other-checker' } : stage
      )),
    };
    expect(isExactGovernanceAmendment(before.value, changedOwner, OWNED, patched!.oldGovernance)).toBe(false);
  });
});
