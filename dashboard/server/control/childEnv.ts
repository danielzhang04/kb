/** Credential-filtered environment for daemon-owned worker subprocesses. */
export const DEFAULT_ENV_ALLOWLIST: readonly string[] = [
  'PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'SYSTEMDRIVE', 'SystemDrive',
  'WINDIR', 'windir', 'COMSPEC', 'ComSpec', 'TEMP', 'TMP', 'HOME', 'HOMEDRIVE', 'HOMEPATH',
  'USERPROFILE', 'USERNAME', 'USERDOMAIN', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER', 'LANG', 'LC_ALL', 'TERM', 'TZ',
];

export const DENIED_ENV_FRAGMENTS: readonly string[] = [
  'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GITHUB_TOKEN',
  'GH_TOKEN', 'GITHUB_PAT', 'GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_PASSWORD', 'GIT_USERNAME',
  'GIT_HTTP_EXTRAHEADER', 'NPM_TOKEN', 'TOKEN', 'PASSWORD', 'SECRET', 'CREDENTIAL', 'API_KEY',
  'APIKEY', 'PRIVATE_KEY',
];

export function isDeniedEnvName(name: string): boolean {
  return DENIED_ENV_FRAGMENTS.some((fragment) => name.toUpperCase().includes(fragment));
}

export function buildChildEnv(
  parentEnv: Record<string, string | undefined>,
  allowlist: readonly string[] = DEFAULT_ENV_ALLOWLIST,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of allowlist) {
    if (isDeniedEnvName(name)) continue;
    const value = parentEnv[name];
    if (typeof value === 'string' && value.length > 0) env[name] = value;
  }
  return env;
}
