/**
 * Windows integration coverage for the native rooted file layer.
 *
 * The setup intentionally uses Node pathname I/O: it models the hostile sibling process. Assertions
 * exercise only the exported rooted-handle API and prove a junction cannot redirect it to the sentinel.
 */
import { createHash } from 'node:crypto';
import { linkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { NoReparseFileError, openNoReparseFileTree } from './noReparseFiles.ts';

const roots: string[] = [];

function makeTemp(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function expectUnsafe(operation: () => unknown): void {
  try {
    operation();
    throw new Error('expected unsafe rooted operation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(NoReparseFileError);
    expect((error as NoReparseFileError).code).toBe('unsafe-path');
  }
}

describe.skipIf(process.platform !== 'win32')('native no-reparse file tree', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('rejects roots before normalization when they use non-local or ambiguous DOS spellings', () => {
    for (const root of [
      'C:relative',
      'C:\\safe\\..\\other',
      'C:\\safe\\',
      'C:\\safe\\CON',
      'C:\\safe\\name:stream',
      'C:/safe',
      '\\\\server\\share',
      '\\\\?\\C:\\safe',
      '\\\\.\\C:\\safe',
    ]) {
      expectUnsafe(() => openNoReparseFileTree(root, { createRoot: false }));
    }
  });

  it('reads, overwrites, hashes, and rejects hardlinks through rooted handles', () => {
    const root = makeTemp('kb-no-reparse-');
    const tree = openNoReparseFileTree(root, { createRoot: false });
    tree.ensureDir(['control']);
    tree.writeUtf8(['control', 'receipt.json'], 'first');
    tree.writeUtf8(['control', 'receipt.json'], 'second');
    expect(tree.readUtf8(['control', 'receipt.json'])).toBe('second');

    writeFileSync(join(root, 'artifact.txt'), 'same-handle hash input', 'utf8');
    const inspected = tree.inspectRegularFile(['artifact.txt'], 'always');
    expect(inspected).toMatchObject({
      size: Buffer.byteLength('same-handle hash input'),
      sha256: createHash('sha256').update('same-handle hash input').digest('hex'),
    });
    expect(inspected?.identity).toMatch(/^\d+:\d+:\d+$/);

    linkSync(join(root, 'artifact.txt'), join(root, 'hardlink.txt'));
    expectUnsafe(() => tree.inspectRegularFile(['hardlink.txt'], 'always'));
  });

  it('resumes an injected short card write only when the durable bytes are an exact prefix', () => {
    const root = makeTemp('kb-no-reparse-complete-');
    mkdirSync(join(root, 'queue'));
    const faulting = openNoReparseFileTree(root, { createRoot: false, testShortWriteBytesOnce: 7 });
    expect(() => faulting.completeUtf8FromPrefix(['queue', 'card.md'], 'exact terminal card bytes'))
      .toThrow(NoReparseFileError);
    expect(readFileSync(join(root, 'queue', 'card.md'), 'utf8')).toBe('exact t');

    const recovered = openNoReparseFileTree(root, { createRoot: false });
    recovered.completeUtf8FromPrefix(['queue', 'card.md'], 'exact terminal card bytes');
    expect(recovered.readUtf8(['queue', 'card.md'])).toBe('exact terminal card bytes');
    writeFileSync(join(root, 'queue', 'card.md'), 'arbitrary drift', 'utf8');
    expectUnsafe(() => recovered.completeUtf8FromPrefix(['queue', 'card.md'], 'exact terminal card bytes'));
  });

  it('same-handle audit append resumes a short suffix without truncating its exact baseline', () => {
    const root = makeTemp('kb-no-reparse-append-');
    mkdirSync(join(root, 'ledgers'));
    const path = join(root, 'ledgers', 'audit.ndjson');
    const baseline = '{"existing":true}\n';
    const suffix = '{"authorized":true}\n';
    writeFileSync(path, baseline, 'utf8');
    const faulting = openNoReparseFileTree(root, { createRoot: false, testShortWriteBytesOnce: 5 });
    expect(() => faulting.appendUtf8IfExact(['ledgers', 'audit.ndjson'], baseline, suffix))
      .toThrow(NoReparseFileError);
    expect(readFileSync(path, 'utf8')).toBe(`${baseline}${suffix.slice(0, 5)}`);

    const recovered = openNoReparseFileTree(root, { createRoot: false });
    recovered.appendUtf8IfExact(['ledgers', 'audit.ndjson'], baseline, suffix);
    expect(recovered.readUtf8(['ledgers', 'audit.ndjson'])).toBe(`${baseline}${suffix}`);
    writeFileSync(path, `${baseline}unrelated\n`, 'utf8');
    expectUnsafe(() => recovered.appendUtf8IfExact(['ledgers', 'audit.ndjson'], baseline, suffix));
  });

  it('inspects absence and proves directory emptiness without following intermediate junctions', () => {
    const root = makeTemp('kb-no-reparse-empty-');
    const outside = makeTemp('kb-no-reparse-empty-outside-');
    mkdirSync(join(root, 'control', 'empty'), { recursive: true });
    const tree = openNoReparseFileTree(root, { createRoot: false });
    expect(tree.pathKind(['control', 'missing'])).toBeNull();
    expect(tree.pathKind(['control', 'empty'])).toBe('directory');
    expect(() => tree.assertEmptyDirectory(['control', 'empty'])).not.toThrow();
    writeFileSync(join(root, 'control', 'empty', 'entry.txt'), 'present', 'utf8');
    expectUnsafe(() => tree.assertEmptyDirectory(['control', 'empty']));
    rmSync(join(root, 'control', 'empty'), { recursive: true, force: true });
    symlinkSync(outside, join(root, 'control', 'empty'), 'junction');
    expectUnsafe(() => tree.pathKind(['control', 'empty']));
    expectUnsafe(() => tree.assertEmptyDirectory(['control', 'empty']));
  });

  it('rejects unsafe relative components before native path resolution', () => {
    const root = makeTemp('kb-no-reparse-components-');
    const tree = openNoReparseFileTree(root, { createRoot: false });
    for (const parts of [
      [''],
      ['.'],
      ['..'],
      ['status', '..'],
      ['status', 'receipt:ads'],
      ['status', 'trailingspace '],
      ['status', 'trailingdot.'],
      ['status', 'LPT1'],
      ['status\\nested'],
    ]) {
      expectUnsafe(() => tree.writeUtf8(parts, 'must not resolve'));
    }
  });

  it('does not follow a junction swapped into a control parent before a delete or write', () => {
    const root = makeTemp('kb-no-reparse-root-');
    const outside = makeTemp('kb-no-reparse-outside-');
    const tree = openNoReparseFileTree(root, { createRoot: false });
    const sentinel = join(outside, 'receipt.json');
    writeFileSync(sentinel, 'outside sentinel', 'utf8');

    mkdirSync(join(root, 'status'));
    rmSync(join(root, 'status'), { recursive: true, force: true });
    symlinkSync(outside, join(root, 'status'), 'junction');

    // This is the exact old check/use attack shape: the parent now points outside immediately before
    // a stale-receipt delete or order/status publication. Both operations must fail closed.
    expectUnsafe(() => tree.deleteFileIfPresent(['status', 'receipt.json']));
    expectUnsafe(() => tree.writeUtf8(['status', 'receipt.json'], 'server token must not escape'));
    expect(readFileSync(sentinel, 'utf8')).toBe('outside sentinel');
  });
});
