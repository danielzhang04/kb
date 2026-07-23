import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileAssignmentAmendmentStore, createFileDefinitionAmendmentStore } from './amendmentStore.ts';

const path = 'orgs/kb-ops/workflows/research.md';
const record = { workflowPath: path, baseSourceHash: 'a'.repeat(64), proposedSourceHash: 'b'.repeat(64), branch: 'claude/m1-dashboard', pr: { url: 'https://example.test/pull/7', number: 7 }, phase: 'pending-human-merge' as const };
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('file assignment amendment store', () => {
  it('survives a fresh store instance and settles only on the exact proposed active hash', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-amendment-state-')); roots.push(root);
    createFileAssignmentAmendmentStore(root).put(record);
    const restarted = createFileAssignmentAmendmentStore(root);
    expect(restarted.lookup(path, record.baseSourceHash)).toEqual({ ok: true, record: { ...record, kind: 'assignment' } });
    expect(restarted.lookup(path, 'c'.repeat(64))).toEqual({ ok: true, record: { ...record, kind: 'assignment' } });
    expect(restarted.lookup(path, record.proposedSourceHash)).toEqual({ ok: true, record: null });
    expect(restarted.lookup(path, 'd'.repeat(64))).toEqual({ ok: true, record: null });
  });

  it('fails closed for a tampered URL or branch', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-amendment-state-')); roots.push(root);
    const store = createFileAssignmentAmendmentStore(root); store.put(record);
    // Locate the opaque file without exposing a caller-controlled path.
    const dir = join(root, 'workflows', 'assignment-amendments');
    const actual = readdirSync(dir)[0];
    writeFileSync(join(dir, actual), JSON.stringify({ ...record, branch: 'main', pr: { url: 'javascript:alert(1)' } }));
    expect(createFileAssignmentAmendmentStore(root).lookup(path, record.baseSourceHash)).toMatchObject({ ok: false });
  });

  it('rejects a symlinked state ancestor rather than escaping the configured state root', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-amendment-state-')); const outside = mkdtempSync(join(tmpdir(), 'kb-amendment-outside-')); roots.push(root, outside);
    mkdirSync(join(root, 'workflows'), { recursive: true });
    symlinkSync(outside, join(root, 'workflows', 'assignment-amendments'), 'junction');
    expect(() => createFileAssignmentAmendmentStore(root).put(record)).toThrow('state directory refused');
  });

  it('loads legacy assignment state without kind and persists explicit kinds for new records', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-amendment-state-')); roots.push(root);
    createFileAssignmentAmendmentStore(root).put(record);
    const dir = join(root, 'workflows', 'assignment-amendments');
    const file = join(dir, readdirSync(dir)[0]);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ kind: 'assignment' });
    const legacy = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    delete legacy.kind;
    writeFileSync(file, `${JSON.stringify(legacy)}\n`, 'utf8');
    expect(createFileDefinitionAmendmentStore(root).lookup(path, record.baseSourceHash)).toMatchObject({ ok: true, record: { kind: 'assignment' } });
    const governance = { ...record, kind: 'governance' as const, proposedSourceHash: 'c'.repeat(64) };
    createFileAssignmentAmendmentStore(root).update(governance);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ kind: 'governance' });
  });
});
