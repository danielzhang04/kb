export function resolveStatePath(
  family: string,
  fallback: string | null,
  env?: Record<string, string | undefined>,
  ...parts: string[]
): string | null;
