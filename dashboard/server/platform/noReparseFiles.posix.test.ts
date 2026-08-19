import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { linkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPosixNoReparseFileTree, parsePosixAbsoluteRoot } from './noReparseFiles.posix.ts';
import { NoReparseFileError } from './noReparseFiles.shared.ts';

const roots: string[] = [];

function makeTemp(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function expectUnsafe(operation: () => unknown): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  if (thrown === undefined) throw new Error('expected unsafe rooted operation to throw, but it succeeded');
  expect(thrown).toBeInstanceOf(NoReparseFileError);
  expect((thrown as NoReparseFileError).code).toBe('unsafe-path');
}

describe('POSIX no-symlink root parsing', () => {
  it('accepts only canonical absolute POSIX shapes without normalizing them', () => {
    expect(parsePosixAbsoluteRoot('/')).toEqual([]);
    expect(parsePosixAbsoluteRoot('/var/lib/kb')).toEqual(['var', 'lib', 'kb']);
    for (const root of ['relative', '//var/lib/kb', '/var/lib/kb/', '/var/../kb', '/var/./kb', '/var\\kb', '/var\0kb']) {
      expectUnsafe(() => parsePosixAbsoluteRoot(root));
    }
  });
});

describe.skipIf(process.platform === 'win32')('descriptor-rooted POSIX no-symlink file tree', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('creates a missing root and performs file operations through pinned descriptors', () => {
    const parent = makeTemp('kb-posix-tree-');
    const root = join(parent, 'state', 'nested').replaceAll('\\', '/');
    const tree = openPosixNoReparseFileTree(root, { createRoot: true });
    tree.ensureDir(['control']);
    tree.writeUtf8(['control', 'receipt.json'], 'first');
    tree.writeUtf8(['control', 'receipt.json'], 'second');
    expect(tree.readUtf8(['control', 'receipt.json'])).toBe('second');
    expect(tree.pathKind(['control'])).toBe('directory');
    expect(tree.pathKind(['control', 'receipt.json'])).toBe('file');
    expect(readFileSync(join(parent, 'state', 'nested', 'control', 'receipt.json'), 'utf8')).toBe('second');
  });

  it('reads, hashes, reports identity, and rejects hardlinks through pinned descriptors', () => {
    const root = makeTemp('kb-posix-hardlinks-');
    const tree = openPosixNoReparseFileTree(root.replaceAll('\\', '/'), { createRoot: false });
    writeFileSync(join(root, 'artifact.txt'), 'same-handle hash input', 'utf8');
    const inspected = tree.inspectRegularFile(['artifact.txt'], 'always');
    expect(inspected).toMatchObject({
      size: Buffer.byteLength('same-handle hash input'),
      sha256: createHash('sha256').update('same-handle hash input').digest('hex'),
    });
    expect(inspected?.identity).toMatch(/^\d+:\d+$/);

    linkSync(join(root, 'artifact.txt'), join(root, 'hardlink.txt'));
    expectUnsafe(() => tree.inspectRegularFile(['hardlink.txt'], 'always'));
  });

  it('deletes present files and empty directories and tolerates their absence', () => {
    const root = makeTemp('kb-posix-delete-');
    const tree = openPosixNoReparseFileTree(root.replaceAll('\\', '/'), { createRoot: false });
    tree.writeUtf8(['stale.txt'], 'stale');
    expect(tree.inspectRegularFile(['stale.txt'], 'never')?.identity).toMatch(/^\d+:\d+$/);
    tree.deleteFileIfPresent(['stale.txt']);
    expect(tree.pathKind(['stale.txt'])).toBeNull();
    expect(() => tree.deleteFileIfPresent(['stale.txt'])).not.toThrow();

    mkdirSync(join(root, 'empty'));
    tree.deleteEmptyDirIfPresent(['empty']);
    expect(tree.pathKind(['empty'])).toBeNull();
    expect(() => tree.deleteEmptyDirIfPresent(['empty'])).not.toThrow();
  });

  it('resumes an injected short card write only when the durable bytes are an exact prefix', () => {
    const root = makeTemp('kb-posix-complete-');
    mkdirSync(join(root, 'queue'));
    const posixRoot = root.replaceAll('\\', '/');
    const faulting = openPosixNoReparseFileTree(posixRoot, { createRoot: false, testShortWriteBytesOnce: 7 });
    expect(() => faulting.completeUtf8FromPrefix(['queue', 'card.md'], 'exact terminal card bytes'))
      .toThrow(NoReparseFileError);
    expect(readFileSync(join(root, 'queue', 'card.md'), 'utf8')).toBe('exact t');

    const recovered = openPosixNoReparseFileTree(posixRoot, { createRoot: false });
    recovered.completeUtf8FromPrefix(['queue', 'card.md'], 'exact terminal card bytes');
    expect(recovered.readUtf8(['queue', 'card.md'])).toBe('exact terminal card bytes');
    writeFileSync(join(root, 'queue', 'card.md'), 'arbitrary drift', 'utf8');
    expectUnsafe(() => recovered.completeUtf8FromPrefix(['queue', 'card.md'], 'exact terminal card bytes'));
  });

  it('same-handle audit append resumes a short suffix without truncating its exact baseline', () => {
    const root = makeTemp('kb-posix-append-');
    mkdirSync(join(root, 'ledgers'));
    const path = join(root, 'ledgers', 'audit.ndjson');
    const baseline = '{"existing":true}\n';
    const suffix = '{"authorized":true}\n';
    writeFileSync(path, baseline, 'utf8');
    const posixRoot = root.replaceAll('\\', '/');
    const faulting = openPosixNoReparseFileTree(posixRoot, { createRoot: false, testShortWriteBytesOnce: 5 });
    expect(() => faulting.appendUtf8IfExact(['ledgers', 'audit.ndjson'], baseline, suffix))
      .toThrow(NoReparseFileError);
    expect(readFileSync(path, 'utf8')).toBe(`${baseline}${suffix.slice(0, 5)}`);

    const recovered = openPosixNoReparseFileTree(posixRoot, { createRoot: false });
    recovered.appendUtf8IfExact(['ledgers', 'audit.ndjson'], baseline, suffix);
    expect(recovered.readUtf8(['ledgers', 'audit.ndjson'])).toBe(`${baseline}${suffix}`);
    writeFileSync(path, `${baseline}unrelated\n`, 'utf8');
    expectUnsafe(() => recovered.appendUtf8IfExact(['ledgers', 'audit.ndjson'], baseline, suffix));
  });

  it('inspects absence and proves directory emptiness without following intermediate symlinks', () => {
    const root = makeTemp('kb-posix-empty-');
    const outside = makeTemp('kb-posix-empty-outside-');
    mkdirSync(join(root, 'control', 'empty'), { recursive: true });
    const tree = openPosixNoReparseFileTree(root.replaceAll('\\', '/'), { createRoot: false });
    expect(tree.pathKind(['control', 'missing'])).toBeNull();
    expect(tree.pathKind(['control', 'empty'])).toBe('directory');
    expect(() => tree.assertEmptyDirectory(['control', 'empty'])).not.toThrow();
    writeFileSync(join(root, 'control', 'empty', 'entry.txt'), 'present', 'utf8');
    expectUnsafe(() => tree.assertEmptyDirectory(['control', 'empty']));
    rmSync(join(root, 'control', 'empty'), { recursive: true, force: true });
    symlinkSync(outside, join(root, 'control', 'empty'), 'dir');
    expectUnsafe(() => tree.pathKind(['control', 'empty']));
    expectUnsafe(() => tree.assertEmptyDirectory(['control', 'empty']));
  });

  it('rejects unsafe relative components before descriptor-rooted resolution', () => {
    const root = makeTemp('kb-posix-components-');
    const tree = openPosixNoReparseFileTree(root.replaceAll('\\', '/'), { createRoot: false });
    for (const parts of [[''], ['.'], ['..'], ['status', '..']]) {
      expectUnsafe(() => tree.writeUtf8(parts, 'must not resolve'));
    }
  });

  it('rejects createRoot traversal through a pre-existing symlink component', () => {
    const parent = makeTemp('kb-posix-create-root-link-');
    const outside = join(parent, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(parent, 'linked'), 'dir');
    const root = join(parent, 'linked', 'nested').replaceAll('\\', '/');
    const tree = openPosixNoReparseFileTree(root, { createRoot: true });
    expectUnsafe(() => tree.pathKind(['receipt.json']));
  });

  it('rejects a FIFO at a control-file name without blocking', () => {
    const root = makeTemp('kb-posix-fifo-');
    execFileSync('mkfifo', [join(root, 'receipt.json')]);
    const tree = openPosixNoReparseFileTree(root.replaceAll('\\', '/'), { createRoot: false });
    expectUnsafe(() => tree.readUtf8(['receipt.json']));
  });

  it('rejects symlink root, intermediate, and final components without touching their targets', () => {
    const parent = makeTemp('kb-posix-links-');
    const root = join(parent, 'root');
    const outside = join(parent, 'outside');
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(join(outside, 'sentinel.txt'), 'outside sentinel', 'utf8');

    symlinkSync(outside, join(parent, 'linked-root'), 'dir');
    const linkedRoot = openPosixNoReparseFileTree(join(parent, 'linked-root').replaceAll('\\', '/'), { createRoot: false });
    expectUnsafe(() => linkedRoot.pathKind(['sentinel.txt']));

    symlinkSync(outside, join(root, 'linked-parent'), 'dir');
    const tree = openPosixNoReparseFileTree(root.replaceAll('\\', '/'), { createRoot: false });
    expectUnsafe(() => tree.writeUtf8(['linked-parent', 'sentinel.txt'], 'escaped'));

    symlinkSync(join(outside, 'sentinel.txt'), join(root, 'linked-file'), 'file');
    expectUnsafe(() => tree.readUtf8(['linked-file']));
    expect(readFileSync(join(outside, 'sentinel.txt'), 'utf8')).toBe('outside sentinel');
  });
});
