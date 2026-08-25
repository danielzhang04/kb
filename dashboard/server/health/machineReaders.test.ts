// Dashboard v3 P5 W4 — machine + daemon reader tests (§3.5). Every timeout scenario runs under
// `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()`: no test ever sleeps for real milliseconds.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAEMON_MACHINE_SECTION_BUDGET_MS, PROBE_BUDGETS_MS } from './probeBudget.ts';
import {
  composeDaemonMachineRows, readDaemonRow, readMachineRows, withBudget, withBudgetMs,
  type MachineReaderPorts,
} from './machineReaders.ts';

const NOW = '2026-08-25T00:00:00.000Z';
const now = () => NOW;
function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('withBudgetMs / withBudget (§3.5 shared wrapper)', () => {
  it('resolves ok when the function settles under budget', async () => {
    await expect(withBudgetMs(1000, () => 'value')).resolves.toEqual({ ok: true, value: 'value' });
  });

  it('never rejects on a hang: it resolves {ok:false, reason:"timeout"} at exactly its budget', async () => {
    const result = withBudgetMs(250, never);
    await vi.advanceTimersByTimeAsync(249);
    // Not yet settled just before the deadline.
    let settled = false;
    void result.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ ok: false, reason: 'timeout' });
  });

  it('never rejects on a synchronous throw: it resolves {ok:false, reason:"unavailable"} and discards the error', async () => {
    const secretStderr = 'stderr: /etc/shadow leaked path';
    await expect(withBudgetMs(100, () => { throw new Error(secretStderr); }))
      .resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('never rejects on a rejected promise: {ok:false, reason:"unavailable"}, error discarded', async () => {
    await expect(withBudgetMs(100, () => Promise.reject(new Error('stderr: boom'))))
      .resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('a value the validator rejects resolves {ok:false, reason:"invalid"}', async () => {
    await expect(withBudgetMs(100, () => 'bad', { validate: () => false }))
      .resolves.toEqual({ ok: false, reason: 'invalid' });
  });

  it('a validator that itself throws (e.g. a throwing getter) resolves {ok:false, reason:"invalid"}, never rejects, and discards the error', async () => {
    const secretStderr = 'stderr: /etc/shadow leaked from validator getter';
    const poisoned = { get field() { throw new Error(secretStderr); } };
    const result = withBudgetMs(100, () => poisoned, {
      validate: (v: typeof poisoned) => { void v.field; return true; },
    });
    await expect(result).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(JSON.stringify(await result)).not.toContain(secretStderr);
  });

  it('withBudget resolves each named probe kind at its §3.5 ceiling', async () => {
    for (const kind of Object.keys(PROBE_BUDGETS_MS) as (keyof typeof PROBE_BUDGETS_MS)[]) {
      const result = withBudget(kind, never);
      await vi.advanceTimersByTimeAsync(PROBE_BUDGETS_MS[kind]);
      await expect(result).resolves.toEqual({ ok: false, reason: 'timeout' });
    }
  });
});

function readyPorts(): MachineReaderPorts {
  return {
    cpu: () => ({ load1: 0.1, load5: 0.2, load15: 0.3 }),
    memory: () => ({ used: 100, total: 200, unit: 'MB' }),
    disk: () => ({ used: 10, total: 100, unit: 'GB' }),
    uptime: () => ({ seconds: 3600 }),
    daemon: () => ({ unit: 'kb-dashboard.service', mainPid: 42, loadedRoot: '/opt/kb-releases/abc', childCount: 3 }),
  };
}

describe('readMachineRows: per-probe isolation', () => {
  it('all four rows are ready when every probe succeeds', async () => {
    const rows = await readMachineRows(readyPorts(), now);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.kind === 'machine')).toBe(true);
    expect(rows.map((row) => row.key).sort()).toEqual(['cpu', 'disk', 'memory', 'uptime']);
  });

  it('a hung disk read degrades exactly the disk row; cpu/memory/uptime stay ready', async () => {
    const ports = { ...readyPorts(), disk: never };
    const pending = readMachineRows(ports, now);
    await vi.advanceTimersByTimeAsync(PROBE_BUDGETS_MS.disk);
    const rows = await pending;
    const byKey = Object.fromEntries(rows.map((row) => [row.kind === 'unavailable' ? 'disk' : row.key, row]));
    expect(rows.filter((row) => row.kind === 'machine').map((row) => row.key).sort()).toEqual(['cpu', 'memory', 'uptime']);
    const unavailableRows = rows.filter((row) => row.kind === 'unavailable');
    expect(unavailableRows).toHaveLength(1);
    expect(unavailableRows[0]!.value).toEqual({ status: 'unavailable', reason: 'timeout' });
    expect(byKey.disk).toBeDefined();
  });

  it('a throwing memory probe degrades exactly the memory row without leaking its error text', async () => {
    const ports: MachineReaderPorts = { ...readyPorts(), memory: () => { throw new Error('stderr: /proc/meminfo denied'); } };
    const rows = await readMachineRows(ports, now);
    expect(rows.filter((row) => row.kind === 'machine').map((row) => row.key).sort()).toEqual(['cpu', 'disk', 'uptime']);
    const unavailableRows = rows.filter((row) => row.kind === 'unavailable');
    expect(unavailableRows).toHaveLength(1);
    expect(unavailableRows[0]!.value.reason).toBe('unavailable');
    expect(JSON.stringify(rows)).not.toContain('meminfo');
  });

  it('a throwing VALIDATOR (not fn) on cpu degrades exactly the cpu row to reason "invalid"; memory/disk/uptime stay ready', async () => {
    const poisonedCpu = {
      get load1(): number { throw new Error('stderr: poisoned validator getter'); },
      load5: 0.2,
      load15: 0.3,
    };
    const ports: MachineReaderPorts = { ...readyPorts(), cpu: () => poisonedCpu };
    const rows = await readMachineRows(ports, now);
    expect(rows.filter((row) => row.kind === 'machine').map((row) => row.key).sort()).toEqual(['disk', 'memory', 'uptime']);
    const unavailableRows = rows.filter((row) => row.kind === 'unavailable');
    expect(unavailableRows).toHaveLength(1);
    expect(unavailableRows[0]!.value).toEqual({ status: 'unavailable', reason: 'invalid' });
    expect(JSON.stringify(rows)).not.toContain('poisoned validator getter');
  });

  it('no machine row ever carries a spend field', async () => {
    const rows = await readMachineRows(readyPorts(), now);
    for (const row of rows) expect(Object.keys(row.value)).not.toContain('spend');
  });
});

describe('readDaemonRow: hanging systemctl vs throwing cgroup walk', () => {
  it('is ready when the daemon probe succeeds', async () => {
    const row = await readDaemonRow(readyPorts(), now);
    expect(row.kind).toBe('daemon');
  });

  it('a hanging systemctl call degrades the daemon row with reason "timeout"', async () => {
    const pending = readDaemonRow({ daemon: never }, now);
    await vi.advanceTimersByTimeAsync(PROBE_BUDGETS_MS.daemon);
    const row = await pending;
    expect(row.kind).toBe('unavailable');
    expect((row as { value: { reason: string } }).value.reason).toBe('timeout');
  });

  it('a throwing cgroup walk degrades the daemon row with reason "unavailable" and no stderr leak', async () => {
    const row = await readDaemonRow({ daemon: () => { throw new Error('stderr: cgroup walk denied /sys/fs/cgroup'); } }, now);
    expect(row.kind).toBe('unavailable');
    expect((row as { value: { reason: string } }).value.reason).toBe('unavailable');
    expect(JSON.stringify(row)).not.toContain('cgroup walk denied');
  });

  it('no daemon row value carries a spend field', async () => {
    const row = await readDaemonRow(readyPorts(), now);
    expect(Object.keys(row.value)).not.toContain('spend');
  });
});

describe('composeDaemonMachineRows: full section, per-row isolation, section ceiling', () => {
  it('returns all five ready rows (four machine + one daemon) when every probe succeeds', async () => {
    const rows = await composeDaemonMachineRows(readyPorts(), now);
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.kind !== 'unavailable')).toBe(true);
  });

  it('a hung disk read and a hanging systemctl each degrade exactly their own row; the rest stay ready', async () => {
    const ports: MachineReaderPorts = { ...readyPorts(), disk: never, daemon: never };
    const pending = composeDaemonMachineRows(ports, now);
    // The daemon budget (1500 ms) is the widest of the two hung probes; advancing to it resolves both.
    await vi.advanceTimersByTimeAsync(PROBE_BUDGETS_MS.daemon);
    const rows = await pending;
    expect(rows).toHaveLength(5);
    const ready = rows.filter((row) => row.kind !== 'unavailable');
    expect(ready.map((row) => row.key).sort()).toEqual(['cpu', 'memory', 'uptime']);
    const unavailableRows = rows.filter((row) => row.kind === 'unavailable');
    expect(unavailableRows).toHaveLength(2);
    for (const row of unavailableRows) expect(row.value).toEqual({ status: 'unavailable', reason: 'timeout' });
  });

  it('completes well inside the 2500 ms section ceiling even when every probe times out at once', async () => {
    const ports: MachineReaderPorts = { cpu: never, memory: never, disk: never, uptime: never, daemon: never };
    const pending = composeDaemonMachineRows(ports, now);
    let settled = false;
    void pending.then(() => { settled = true; });
    // The widest per-probe budget (daemon, 1500 ms) resolves everything well before the 2500 ms ceiling.
    await vi.advanceTimersByTimeAsync(PROBE_BUDGETS_MS.daemon);
    await Promise.resolve();
    expect(settled).toBe(true);
    const rows = await pending;
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.kind === 'unavailable')).toBe(true);
  });

  it('the section-level ceiling itself caps at exactly DAEMON_MACHINE_SECTION_BUDGET_MS on a raw hang', async () => {
    const result = withBudgetMs(DAEMON_MACHINE_SECTION_BUDGET_MS, never);
    await vi.advanceTimersByTimeAsync(DAEMON_MACHINE_SECTION_BUDGET_MS - 1);
    let settled = false;
    void result.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ ok: false, reason: 'timeout' });
  });
});
