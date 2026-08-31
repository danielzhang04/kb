import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  runEvidenceCli,
  runEvidenceCommand,
  safeCommand,
  type EvidenceCommand,
  type EvidenceIo,
  type UnsupportedVmSurfacesProbeIo,
} from './evidence.ts';
import { resolvePython } from './python.ts';

const COMMIT = 'a'.repeat(40);
const ARTIFACT = 'b'.repeat(64);
const BOOT_ID = '11111111-1111-1111-8111-111111111111';
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function fixtureEvidenceCommand(directory: string): EvidenceCommand {
  return {
    key: 'pythonProductionResolver', releaseCommit: COMMIT, artifactSha256: ARTIFACT,
    rawFile: join(directory, 'pythonProductionResolver.raw.json'),
    reportFile: join(directory, 'pythonProductionResolver.json'),
    command: ['npm', 'test', '--', 'server/runtime/capabilities.test.ts'], cwd: REPO_ROOT,
  };
}

function fakeEvidenceIo(): EvidenceIo {
  let now = 0;
  return {
    now: () => new Date(Date.parse('2026-08-14T12:00:00.000Z') + now++),
    run: async (command) => command[0] === 'python3'
      ? { exitCode: 0, stdout: '/usr/bin/python3.13\n3.13.5\n', stderr: '' }
      : { exitCode: 0, stdout: 'passed\n', stderr: '' },
    realpath: () => '/usr/bin/node', machineId: () => 'vm-1', bootId: () => BOOT_ID,
    writeExclusiveAndFsync: (path, value) => writeFileSync(path, value, { encoding: 'utf8', flag: 'wx' }),
    writeCanonicalExclusiveAndFsync: (path, payload) => writeFileSync(path, canonicalJson(payload), { encoding: 'utf8', flag: 'wx' }),
  };
}

describe('runEvidenceCommand', () => {
  it('records executable paths and versions and requires both command and Python identity success', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'evidence-'));
    const command = fixtureEvidenceCommand(directory);
    const result = await runEvidenceCommand(command, fakeEvidenceIo());
    expect(result.passed).toBe(true);
    expect(JSON.parse(readFileSync(command.rawFile, 'utf8')).runtime).toMatchObject({
      node: { realpath: '/usr/bin/node', version: process.version },
      python: { command: 'python3', realpath: '/usr/bin/python3.13', version: '3.13.5' },
    });
    expect(result.rawOutput.file).toBe('pythonProductionResolver.raw.json');

    const python = resolvePython();
    expect(() => execFileSync(python.command, [...python.prefixArgs, '-c', [
      'import sys', 'from scripts.gates.phase1_gate1 import parse_closed_evidence',
      'parse_closed_evidence(open(sys.argv[1], "rb").read())',
    ].join(';'), command.reportFile], { cwd: REPO_ROOT, stdio: 'pipe' })).not.toThrow();

    const identityFailureDirectory = mkdtempSync(join(tmpdir(), 'evidence-'));
    const identityFailureIo = fakeEvidenceIo();
    identityFailureIo.run = async (argv) => argv[0] === 'python3'
      ? { exitCode: 1, stdout: '', stderr: 'python identity unavailable' }
      : { exitCode: 0, stdout: 'passed\n', stderr: '' };
    const identityFailure = await runEvidenceCommand(fixtureEvidenceCommand(identityFailureDirectory), identityFailureIo);
    expect(identityFailure.passed).toBe(false);
    expect(JSON.parse(readFileSync(join(identityFailureDirectory, 'pythonProductionResolver.raw.json'), 'utf8'))).toMatchObject({
      runtime: { python: { exitCode: 1, stderr: 'python identity unavailable' } },
    });

    const rejectedDirectory = mkdtempSync(join(tmpdir(), 'evidence-'));
    await expect(runEvidenceCommand({ ...fixtureEvidenceCommand(rejectedDirectory), extra: true } as EvidenceCommand, fakeEvidenceIo()))
      .rejects.toThrow('closed evidence command input required');
  });

  it('refuses standalone bearer/JWT values and URL-embedded credentials', () => {
    const bearer = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const githubUrl = 'https://x:ghp_1234567890abcdefghijklmnopqrstuvwxyz12@github.com/example/repo.git';
    expect(() => safeCommand(['curl', '-H', bearer])).toThrow('credential value in evidence command');
    expect(() => safeCommand(['curl', '-H', jwt])).toThrow('credential value in evidence command');
    expect(() => safeCommand(['git', 'clone', githubUrl])).toThrow('credential value in evidence command');
  });

  it('runs probe-unsupported-surfaces as an internal argv-only evidence command', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'evidence-'));
    const probe: UnsupportedVmSurfacesProbeIo = {
      mainPid: () => 42,
      cmdline: () => 'node\0server/index.ts\0',
      descendantPids: () => [43],
    };
    const payload = await runEvidenceCli([
      'probe-unsupported-surfaces',
      '--key', 'unsupportedVmSurfacesSafe',
      '--release-commit', COMMIT,
      '--artifact-sha256', ARTIFACT,
      '--raw', join(directory, 'unsupportedVmSurfacesSafe.raw.json'),
      '--report', join(directory, 'unsupportedVmSurfacesSafe.json'),
    ], fakeEvidenceIo(), probe);
    expect(payload.passed).toBe(true);
    expect(payload.command).toEqual(['probe-unsupported-surfaces']);
    expect(JSON.parse(readFileSync(join(directory, 'unsupportedVmSurfacesSafe.raw.json'), 'utf8'))).toMatchObject({
      stdout: expect.stringContaining('agentCliChildPids'),
    });
  });
});
