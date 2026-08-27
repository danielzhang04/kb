import { BridgeError } from './errors.js';

export interface BridgeConfig {
  readonly enabled: boolean;
  readonly mutationsEnabled: boolean;
  readonly origin: string;
  readonly reviewProfiles: Readonly<Record<string, string>>;
  readonly requestTimeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxIndexBytes: number;
  readonly maxResultBytes: number;
}

function flag(value: string | undefined): boolean {
  return value === '1';
}

function exactOrigin(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BridgeError('invalid_arguments', 'ATLAS_KB_ORIGIN must be an absolute HTTP origin');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new BridgeError('invalid_arguments', 'ATLAS_KB_ORIGIN must contain only scheme, host, and port');
  }
  return parsed.origin;
}

function profiles(raw: string | undefined): Readonly<Record<string, string>> {
  if (!raw) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new BridgeError('invalid_arguments', 'ATLAS_KB_REVIEW_PROFILES must be a JSON object');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BridgeError('invalid_arguments', 'ATLAS_KB_REVIEW_PROFILES must be a JSON object');
  }
  const output: Record<string, string> = {};
  const safe = /^[a-z0-9][a-z0-9_-]{0,63}$/;
  for (const [name, workflowId] of Object.entries(value)) {
    if (!safe.test(name) || typeof workflowId !== 'string' || !safe.test(workflowId)) {
      throw new BridgeError('invalid_arguments', 'review profile mappings must contain safe names and workflow ids');
    }
    output[name] = workflowId;
  }
  return output;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  return {
    enabled: flag(env.ATLAS_KB_BRIDGE_ENABLED),
    mutationsEnabled: flag(env.ATLAS_KB_MUTATIONS_ENABLED),
    origin: exactOrigin(env.ATLAS_KB_ORIGIN ?? 'http://127.0.0.1:5317'),
    reviewProfiles: profiles(env.ATLAS_KB_REVIEW_PROFILES),
    requestTimeoutMs: 10_000,
    maxResponseBytes: 2 * 1024 * 1024,
    maxIndexBytes: 16 * 1024 * 1024,
    maxResultBytes: 16 * 1024,
  };
}
