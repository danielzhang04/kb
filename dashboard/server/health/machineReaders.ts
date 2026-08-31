// Dashboard v3 P5 — W4 Health machine + daemon readers (§3.5). Every probe is invoked through the one
// shared `withBudget` wrapper, which RESOLVES (never rejects) and turns a timeout, a synchronous throw,
// a rejected promise, or a malformed value into the shipped closed `UnavailableRow`. A hung disk read, a
// hanging `systemctl`, or a throwing cgroup walk degrades exactly the one row it feeds; every other row
// in the composition stays ready. Raw `stderr` never reaches a row: the catch below discards the caught
// error entirely and reports only the closed `ProbeUnavailableReason`. No row carries a spend field.
import type { UnavailableRow } from './service.ts';
import {
  DAEMON_MACHINE_SECTION_BUDGET_MS, probeBudgetMs,
  type DaemonRow, type DaemonRowValue, type MachineRow, type ProbeKind, type ProbeUnavailableReason,
} from './probeBudget.ts';

// ---------------------------------------------------------------------------------------------------
// Scheduler port. Defaults to real `setTimeout`/`clearTimeout`; tests inject none and instead drive the
// real timer under `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()`, so no test ever sleeps for
// wall-clock milliseconds.
// ---------------------------------------------------------------------------------------------------
export interface TimerHandle { unref?(): void }
export interface SchedulerPort {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}
export const realScheduler: SchedulerPort = {
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as TimerHandle,
  clearTimeout: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
};

export type BudgetResult<T> = { ok: true; value: T } | { ok: false; reason: ProbeUnavailableReason };

/**
 * Runs `fn` under a `ms`-millisecond ceiling. Resolves — NEVER rejects — with `{ok:false}` on a timeout,
 * a synchronous throw, a rejected promise, or a value `validate` rejects. This is the primitive the
 * §3.5 per-probe wrapper and the section-level ceiling both share.
 */
export async function withBudgetMs<T>(
  ms: number,
  fn: () => Promise<T> | T,
  options: { scheduler?: SchedulerPort; validate?: (value: T) => boolean } = {},
): Promise<BudgetResult<T>> {
  const scheduler = options.scheduler ?? realScheduler;
  let timer: TimerHandle | undefined;
  const timeout = new Promise<BudgetResult<T>>((resolve) => {
    timer = scheduler.setTimeout(() => resolve({ ok: false, reason: 'timeout' }), ms);
    timer.unref?.();
  });
  const attempt = (async (): Promise<BudgetResult<T>> => {
    let value: T;
    try {
      value = await fn();
    } catch {
      // The caught error (which may carry raw stderr) is deliberately discarded here — only the closed
      // reason crosses into a row.
      return { ok: false, reason: 'unavailable' };
    }
    try {
      if (options.validate && !options.validate(value)) return { ok: false, reason: 'invalid' };
    } catch {
      // A validator that itself throws (e.g. a throwing getter on the resolved value) is treated the
      // same as a failed validation: the thrown error is discarded, never surfaced in a row.
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, value };
  })();
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    if (timer) scheduler.clearTimeout(timer);
  }
}

/** Convenience over `withBudgetMs` for a named §3.5 probe kind. */
export function withBudget<T>(
  kind: ProbeKind,
  fn: () => Promise<T> | T,
  options: { scheduler?: SchedulerPort; validate?: (value: T) => boolean } = {},
): Promise<BudgetResult<T>> {
  return withBudgetMs(probeBudgetMs(kind), fn, options);
}

// ---------------------------------------------------------------------------------------------------
// Injected machine + daemon ports. Real implementations read `/proc`, `os.*`, `systemctl show`, and a
// cgroup walk; tests inject doubles that hang, throw, or return malformed values.
// ---------------------------------------------------------------------------------------------------
export type CpuReading = { load1: number; load5: number; load15: number };
export type UsageReading = { used: number; total: number; unit: string };
export type UptimeReading = { seconds: number };

export interface MachineReaderPorts {
  cpu(): Promise<CpuReading> | CpuReading;
  memory(): Promise<UsageReading> | UsageReading;
  disk(): Promise<UsageReading> | UsageReading;
  uptime(): Promise<UptimeReading> | UptimeReading;
  /** One composed call standing in for `systemctl show` + the cgroup walk (§3.5); either failing
   *  (hang or throw) degrades only the daemon `service` row. */
  daemon(): Promise<DaemonRowValue> | DaemonRowValue;
}

function isCpuReading(value: CpuReading): boolean {
  return Number.isFinite(value?.load1) && Number.isFinite(value?.load5) && Number.isFinite(value?.load15);
}
function isUsageReading(value: UsageReading): boolean {
  return Number.isFinite(value?.used) && Number.isFinite(value?.total) && typeof value?.unit === 'string' && value.unit.length > 0;
}
function isUptimeReading(value: UptimeReading): boolean {
  return Number.isInteger(value?.seconds) && value.seconds >= 0;
}
function isDaemonReading(value: DaemonRowValue): boolean {
  return typeof value?.unit === 'string' && value.unit.length > 0
    && Number.isInteger(value?.mainPid) && value.mainPid > 0
    && typeof value?.loadedRoot === 'string' && value.loadedRoot.length > 0
    && Number.isInteger(value?.childCount) && value.childCount >= 0;
}

function unavailableDaemonMachineRow(reason: ProbeUnavailableReason, observedAt: string): UnavailableRow<'daemon-machine'> {
  return { kind: 'unavailable', key: 'error:daemon-machine', label: 'Unavailable', value: { status: 'unavailable', reason }, observedAt, source: 'error' };
}

/** The four `MachineRow`s, read independently and in parallel: a fault in one probe never blocks or
 *  invalidates the others (§3.5). */
export async function readMachineRows(
  ports: MachineReaderPorts,
  now: () => string,
  scheduler?: SchedulerPort,
): Promise<Array<MachineRow | UnavailableRow<'daemon-machine'>>> {
  const observedAt = now();
  const [cpu, memory, disk, uptime] = await Promise.all([
    withBudget('cpu', () => ports.cpu(), { scheduler, validate: isCpuReading }),
    withBudget('memory', () => ports.memory(), { scheduler, validate: isUsageReading }),
    withBudget('disk', () => ports.disk(), { scheduler, validate: isUsageReading }),
    withBudget('uptime', () => ports.uptime(), { scheduler, validate: isUptimeReading }),
  ]);
  return [
    cpu.ok
      ? { kind: 'machine', key: 'cpu', label: 'CPU', value: cpu.value, observedAt, source: 'machine' }
      : unavailableDaemonMachineRow(cpu.reason, observedAt),
    memory.ok
      ? { kind: 'machine', key: 'memory', label: 'Memory', value: memory.value, observedAt, source: 'machine' }
      : unavailableDaemonMachineRow(memory.reason, observedAt),
    disk.ok
      ? { kind: 'machine', key: 'disk', label: 'Disk', value: disk.value, observedAt, source: 'machine' }
      : unavailableDaemonMachineRow(disk.reason, observedAt),
    uptime.ok
      ? { kind: 'machine', key: 'uptime', label: 'Uptime', value: uptime.value, observedAt, source: 'machine' }
      : unavailableDaemonMachineRow(uptime.reason, observedAt),
  ];
}

/** The one `DaemonRow`, bounded at the §3.5 `daemon` budget (1500 ms — the widest single-probe budget,
 *  because it covers both `systemctl show` and the cgroup walk). */
export async function readDaemonRow(
  ports: Pick<MachineReaderPorts, 'daemon'>,
  now: () => string,
  scheduler?: SchedulerPort,
): Promise<DaemonRow | UnavailableRow<'daemon-machine'>> {
  const observedAt = now();
  const result = await withBudget('daemon', () => ports.daemon(), { scheduler, validate: isDaemonReading });
  if (!result.ok) return unavailableDaemonMachineRow(result.reason, observedAt);
  return { kind: 'daemon', key: 'service', label: 'Service', value: result.value, observedAt, source: 'daemon' };
}

/**
 * The full machine + daemon slice of the `daemon-machine` section, additionally wrapped at the §3.5
 * section-level ceiling (`DAEMON_MACHINE_SECTION_BUDGET_MS` = 2500 ms). Every per-probe budget already
 * resolves well inside 2500 ms on its own; this outer ceiling is the structural backstop so the section
 * can never hang even if a future probe were mis-budgeted.
 */
export async function composeDaemonMachineRows(
  ports: MachineReaderPorts,
  now: () => string,
  scheduler?: SchedulerPort,
): Promise<Array<MachineRow | DaemonRow | UnavailableRow<'daemon-machine'>>> {
  const observedAt = now();
  const result = await withBudgetMs(
    DAEMON_MACHINE_SECTION_BUDGET_MS,
    async () => {
      const [machine, daemon] = await Promise.all([
        readMachineRows(ports, now, scheduler),
        readDaemonRow(ports, now, scheduler),
      ]);
      return [...machine, daemon];
    },
    { scheduler },
  );
  return result.ok ? result.value : [unavailableDaemonMachineRow(result.reason, observedAt)];
}
