import { accessSync, constants, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { resolveDashboardStateRoot } from '../composer/store.ts';
import { emptyControlPlaneDocument } from './generated/controlPlaneSchema.ts';
import {
  createDeploymentFixture,
  createLeasedFileStoreForTest,
} from './test-fixtures/controlStore.ts';
import type { ControlResult, Deployment, DeploymentTransitionPatch } from './types.ts';

async function runVmDurabilityBenchmark(): Promise<void> {
  const source = process.env.KB_VM_DURABILITY_SOURCE
    ?? join(resolveDashboardStateRoot(), 'control', 'control-plane.json');
  let sourceBytes: number;
  try {
    accessSync(source, constants.R_OK);
    sourceBytes = statSync(source).size;
  } catch {
    throw new Error(`KB_VM_DURABILITY_SOURCE is absent or unreadable: ${source}`);
  }

  const opened = createLeasedFileStoreForTest(
    { persistenceTargetBytesForTest: sourceBytes * 2 },
    emptyControlPlaneDocument(),
  );
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  const durations: number[] = [];
  histogram.enable();
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    const measure = async (fn: () => ControlResult<Deployment>): Promise<Deployment> => {
      const started = performance.now();
      const result = fn();
      durations.push(performance.now() - started);
      if (!result.ok) throw new Error(result.detail);
      await new Promise<void>((resolve) => setImmediate(resolve));
      return result.value;
    };

    for (let cycle = 1; cycle <= 14; cycle += 1) {
      let current = await measure(() => opened.store.createDeployment(
        'operator', createDeploymentFixture(cycle),
      ));
      for (const nextState of [
        'requested', 'parked', 'swapping', 'resuming', 'succeeded', 'acknowledged',
      ] as const) {
        let patch: DeploymentTransitionPatch = {};
        if (nextState === 'succeeded') {
          patch = {
            terminalOutcome: {
              kind: 'succeeded',
              at: '2026-08-20T01:00:00.000Z',
              by: 'operator',
            },
          };
        } else if (nextState === 'acknowledged') {
          patch = {
            acknowledgedBy: {
              subject: 'operator',
              at: '2026-08-20T01:01:00.000Z',
            },
          };
        }
        const prior = current;
        current = await measure(() => opened.store.transitionDeployment(
          'operator', prior.deploymentRef, {
            expectedRevision: prior.revision,
            expectedState: prior.state,
            nextState,
            idempotencyKey: `${prior.deploymentRef}:${nextState}`,
            patch,
          },
        ));
      }
    }

    let current = await measure(() => opened.store.createDeployment(
      'operator', createDeploymentFixture(15),
    ));
    const prior = current;
    current = await measure(() => opened.store.transitionDeployment(
      'operator', prior.deploymentRef, {
        expectedRevision: prior.revision,
        expectedState: prior.state,
        nextState: 'aborted',
        idempotencyKey: `${prior.deploymentRef}:aborted`,
        patch: {
          terminalOutcome: {
            kind: 'aborted',
            at: '2026-08-20T01:02:00.000Z',
            by: 'operator',
          },
        },
      },
    ));
    expect(current.state).toBe('aborted');
  } finally {
    histogram.disable();
    opened.close();
  }

  expect(durations).toHaveLength(100);
  durations.sort((left, right) => left - right);
  const p99 = durations[Math.ceil(0.99 * durations.length) - 1]!;
  expect(p99).toBeLessThanOrEqual(250);
  expect(histogram.max / 1e6).toBeLessThanOrEqual(1_000);
}

it('proves the durability measurement harness against a local source size', async () => {
  const root = mkdtempSync(join(tmpdir(), 'control-durability-source-'));
  const source = join(root, 'control-plane.json');
  const prior = process.env.KB_VM_DURABILITY_SOURCE;
  try {
    writeFileSync(source, Buffer.alloc(128 * 1024));
    process.env.KB_VM_DURABILITY_SOURCE = source;
    await runVmDurabilityBenchmark();
  } finally {
    if (prior === undefined) delete process.env.KB_VM_DURABILITY_SOURCE;
    else process.env.KB_VM_DURABILITY_SOURCE = prior;
    rmSync(root, { recursive: true, force: true });
  }
});

it.skipIf(process.env.KB_VM_DURABILITY_BENCHMARK !== '1')(
  'meets the VM deploy-critical latency budget',
  async () => { await runVmDurabilityBenchmark(); },
);
