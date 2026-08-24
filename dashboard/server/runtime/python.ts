import { execFileSync } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PythonRunOptions {
  cwd: string;
  platformRoot?: string;
  input?: string;
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
  /** Stdout ceiling in bytes; defaults to `PYTHON_STDOUT_MAX_BYTES`. Test-only override. */
  maxBuffer?: number;
}

/**
 * Node's `execFileSync` default is 1 MiB, which is ~30x smaller than one legal
 * `learning_proposals.py read`: `MAX_RECORDS_PER_DIRECTORY` (500) x `MAX_RECORD_BYTES` (65536)
 * = 32 MiB of record text, plus JSON re-encoding overhead (quoted keys, `\uXXXX` escapes and the
 * envelope) — 40 MiB covers the worst legal read with headroom and still fails closed above it.
 * A directory that overflows this is a real refusal, not a silently truncated read.
 */
export const PYTHON_STDOUT_MAX_BYTES = 40 * 1024 * 1024;

export function resolvePython(
  platform: NodeJS.Platform = process.platform,
): Readonly<{ command: string; prefixArgs: readonly string[] }> {
  return platform === 'win32'
    ? { command: 'py', prefixArgs: ['-3'] }
    : { command: 'python3', prefixArgs: [] };
}

export function defaultPlatformRoot(): string {
  return process.env.DASHBOARD_PLATFORM_ROOT
    ?? fileURLToPath(new URL('../../../', import.meta.url));
}

/** Convert execFileSync failures into the shared runner result without hiding timeout context. */
export function pythonFailureResult(error: unknown): { exitCode: number; stdout: string; stderr: string } {
  const failure = error as {
    status?: number | null;
    signal?: string | null;
    code?: string;
    stdout?: Buffer | string;
    stderr?: Buffer | string;
  };
  // Both a timeout and a stdout overflow terminate with SIGTERM, so the signal alone is
  // ambiguous and reads as "timeout" to anyone triaging. Name the cause from `code`.
  const cause = failure.code === 'ENOBUFS'
    ? `stdout exceeded the ${PYTHON_STDOUT_MAX_BYTES}-byte ceiling`
    : failure.code === 'ETIMEDOUT' ? 'the process exceeded its time budget' : '';
  const synthesized = [
    cause,
    failure.signal ? `signal ${failure.signal}` : '',
    error instanceof Error ? error.message : String(error),
  ].filter(Boolean).join(': ');
  return {
    exitCode: typeof failure.status === 'number' ? failure.status : 1,
    stdout: failure.stdout?.toString() ?? '',
    stderr: failure.stderr?.toString() || synthesized,
  };
}

export function runPythonSync(args: readonly string[], options: PythonRunOptions): string {
  const python = resolvePython();
  const platformRoot = options.platformRoot ?? defaultPlatformRoot();
  return execFileSync(python.command, [...python.prefixArgs, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeoutMs ?? 30_000,
    maxBuffer: options.maxBuffer ?? PYTHON_STDOUT_MAX_BYTES,
    windowsHide: true,
    env: {
      ...(options.environment ?? process.env),
      PYTHONPATH: [join(platformRoot, 'scripts'), (options.environment ?? process.env).PYTHONPATH].filter(Boolean).join(delimiter),
    },
  });
}
