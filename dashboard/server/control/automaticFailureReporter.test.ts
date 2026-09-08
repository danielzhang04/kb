import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { superviseDetachedAutomaticExecution } from './automaticFailureReporter.ts';

const childPath = fileURLToPath(new URL('./test-fixtures/automaticFailureReporterChild.ts', import.meta.url));
const moduleUrl = new URL('./automaticFailureReporter.ts', import.meta.url).href;

function child(mode: 'safe' | 'unsafe') {
  return spawnSync(process.execPath, ['--unhandled-rejections=strict', childPath, mode, moduleUrl], {
    encoding: 'utf8', windowsHide: true,
  });
}

describe('detached automatic-execution supervision', () => {
  it('uses a strict child control that proves an unsafe reporter rejection is process-fatal', () => {
    const result = child('unsafe');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unsafe reporter rejection');
    expect(result.stdout).not.toContain('SURVIVED');
  });

  it('survives rejected success/failure reporters and throwing/rejected loggers in a strict child', () => {
    const result = child('safe');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('SURVIVED');
    expect(result.stderr).not.toContain('engine-private-sentinel');
  });

  it('attempts one metadata-only fallback with a validated run reference', async () => {
    const lines: string[] = [];
    superviseDetachedAutomaticExecution(Promise.reject(new Error('engine-private-sentinel')), {
      surface: 'manager-successor', runRef: 'run-bad\nengine-private-sentinel',
      onRejected: async () => { throw new Error('reporter-private-sentinel'); },
      log: async (line) => { lines.push(line); },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lines).toEqual([
      '[automatic-execution:manager-successor] detached reporter failed for run invalid-run-ref',
    ]);
    expect(lines[0]).not.toContain('private-sentinel');
  });

  it('assimilates hostile thenables without exposing their rejection', async () => {
    const lines: string[] = [];
    const operation = Object.defineProperty({}, 'then', {
      get: () => { throw new Error('thenable-engine-private-sentinel'); },
    }) as PromiseLike<never>;
    superviseDetachedAutomaticExecution(operation, {
      surface: 'post-ack-execution', runRef: 'run-hostile-thenable',
      onRejected: async () => { throw new Error('thenable-reporter-private-sentinel'); },
      log: (line) => { lines.push(line); },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lines).toEqual([
      '[automatic-execution:post-ack-execution] detached reporter failed for run run-hostile-thenable',
    ]);
    expect(lines[0]).not.toContain('private-sentinel');
  });
});
