import { execFileSync } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PythonRunOptions {
  cwd: string;
  platformRoot?: string;
  input?: string;
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
}

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

export function runPythonSync(args: readonly string[], options: PythonRunOptions): string {
  const python = resolvePython();
  const platformRoot = options.platformRoot ?? defaultPlatformRoot();
  return execFileSync(python.command, [...python.prefixArgs, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeoutMs ?? 30_000,
    windowsHide: true,
    env: {
      ...(options.environment ?? process.env),
      PYTHONPATH: [join(platformRoot, 'scripts'), (options.environment ?? process.env).PYTHONPATH].filter(Boolean).join(delimiter),
    },
  });
}
