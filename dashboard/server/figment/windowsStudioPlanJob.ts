import { createRequire } from 'node:module';

// Owned, unnamed, non-inheritable Windows Job Object for the studio planner
// tree. The dashboard process holds the only handle: KILL_ON_JOB_CLOSE takes
// every member down if the app crashes, and no breakaway flag is ever set, so
// ordinary CreateProcess descendants inherit the job even after their parent
// exits. This is tree ownership for a trusted planner, not a malicious-process
// sandbox. Any missing native capability yields null / false (fail closed).

const nodeRequire = createRequire(import.meta.url);
const JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION = 1;
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
// AssignProcessToJobObject needs SET_QUOTA + TERMINATE; IsProcessInJob needs query.
const PROCESS_ASSIGN_ACCESS = 0x0100 | 0x0001 | 0x1000;
// LLP64 layouts (x64/arm64): JOBOBJECT_EXTENDED_LIMIT_INFORMATION is 144 bytes
// with LimitFlags at 16; BASIC_ACCOUNTING is 48 bytes with ActiveProcesses at 40.
const EXTENDED_LIMIT_SIZE = 144;
const LIMIT_FLAGS_OFFSET = 16;
const ACCOUNTING_SIZE = 48;
const ACTIVE_PROCESSES_OFFSET = 40;
const CONFIRM_POLL_MS = 25;

export type WindowsJob = {
  /** Assign an existing live process (by pid) to this job; true only when verified. */
  assign(pid: number): boolean;
  /** TerminateJobObject, then poll until ActiveProcesses === 0 within the deadline. */
  terminateAndConfirmEmpty(deadlineMs: number): Promise<boolean>;
  /** Close the only handle (idempotent); KILL_ON_JOB_CLOSE reaps any member left. */
  close(): void;
};

type KoffiFn = (...args: unknown[]) => unknown;
interface Koffi {
  load(name: string): { func(convention: string, name: string, result: string, args: unknown[]): KoffiFn };
  address(value: unknown): number | bigint;
}

function badHandle(koffi: Koffi, handle: unknown): boolean {
  try {
    const address = BigInt(koffi.address(handle));
    return address === 0n || BigInt.asIntN(64, address) === -1n;
  } catch { return true; }
}

function loadBindings() {
  const koffi = nodeRequire('koffi') as Koffi;
  const kernel32 = koffi.load('kernel32.dll');
  const H = 'void *';
  // Win32 BOOL is a 4-byte int, not a C99 1-byte bool; nonzero is true.
  const BOOL = 'int';
  const fn = (name: string, result: string, args: string[]) => kernel32.func('__stdcall', name, result, args);
  return {
    koffi,
    CreateJobObjectW: fn('CreateJobObjectW', H, [H, H]),
    SetInformationJobObject: fn('SetInformationJobObject', BOOL, [H, 'int', H, 'uint32']),
    QueryInformationJobObject: fn('QueryInformationJobObject', BOOL, [H, 'int', H, 'uint32', H]),
    OpenProcess: fn('OpenProcess', H, ['uint32', BOOL, 'uint32']),
    AssignProcessToJobObject: fn('AssignProcessToJobObject', BOOL, [H, H]),
    IsProcessInJob: fn('IsProcessInJob', BOOL, [H, H, H]),
    TerminateJobObject: fn('TerminateJobObject', BOOL, [H, 'uint32']),
    CloseHandle: fn('CloseHandle', BOOL, [H]),
  };
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Creates the owned job, or null when the host cannot provide one. */
export function createWindowsStudioPlanJob(): WindowsJob | null {
  if (process.platform !== 'win32' || (process.arch !== 'x64' && process.arch !== 'arm64')) return null;
  let b: ReturnType<typeof loadBindings>;
  try { b = loadBindings(); } catch { return null; }
  // Null attributes = non-inheritable handle; null name = no global namespace.
  const job = b.CreateJobObjectW(null, null);
  if (badHandle(b.koffi, job)) return null;
  let open = true;
  const close = () => { if (open) { open = false; b.CloseHandle(job); } };
  const limits = Buffer.alloc(EXTENDED_LIMIT_SIZE);
  limits.writeUInt32LE(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, LIMIT_FLAGS_OFFSET);
  if (!b.SetInformationJobObject(job, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, limits, EXTENDED_LIMIT_SIZE)) {
    close();
    return null;
  }
  const activeProcesses = (): number | null => {
    const info = Buffer.alloc(ACCOUNTING_SIZE);
    if (!open || !b.QueryInformationJobObject(job, JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION, info, ACCOUNTING_SIZE, null)) return null;
    return info.readUInt32LE(ACTIVE_PROCESSES_OFFSET);
  };
  return {
    assign(pid) {
      if (!open || !Number.isInteger(pid) || pid <= 0) return false;
      const proc = b.OpenProcess(PROCESS_ASSIGN_ACCESS, 0, pid);
      if (badHandle(b.koffi, proc)) return false;
      try {
        if (!b.AssignProcessToJobObject(job, proc)) return false;
        const inJob = Buffer.alloc(4);
        return Boolean(b.IsProcessInJob(proc, job, inJob)) && inJob.readInt32LE(0) !== 0;
      } finally { b.CloseHandle(proc); }
    },
    async terminateAndConfirmEmpty(deadlineMs) {
      if (!open) return false;
      b.TerminateJobObject(job, 1);
      const deadline = Date.now() + deadlineMs;
      for (;;) {
        const active = activeProcesses();
        if (active === 0) return true;
        if (active === null || Date.now() >= deadline) return false;
        await sleep(CONFIRM_POLL_MS);
      }
    },
    close,
  };
}
