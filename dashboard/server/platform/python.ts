export interface PythonInvocation {
  command: string;
  baseArgs: string[];
}

export interface PythonInvocationOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
}

/** Resolve the interpreter used to run repository Python scripts. */
export function pythonInvocation(options: PythonInvocationOptions = {}): PythonInvocation {
  const env = options.env ?? process.env;
  const configured = env.KB_PYTHON;
  if (configured) return { command: configured, baseArgs: [] };

  // Transitional local-development default; removed with the Windows cutover.
  if ((options.platform ?? process.platform) === 'win32') return { command: 'py', baseArgs: ['-3'] };
  return { command: 'python3', baseArgs: [] };
}
