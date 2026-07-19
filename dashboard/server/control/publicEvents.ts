import { redactSensitiveText } from '../composer/publicTimeline.ts';

export type PublicOperationalEvent =
  | { kind: 'message'; text: string }
  | { kind: 'session'; sessionRef: string; parentSessionRef: string | null; role: 'manager' | 'worker'; state: string }
  | { kind: 'command'; label: string; status: 'started' | 'succeeded' | 'failed'; path: string | null }
  | { kind: 'tool'; name: string; status: 'started' | 'succeeded' | 'failed' }
  | { kind: 'file'; path: string; operation: 'read' | 'created' | 'modified' | 'deleted' }
  | { kind: 'diff'; path: string; summary: string }
  | { kind: 'checkpoint'; name: string; state: 'reached' | 'released' | 'blocked' }
  | { kind: 'lifecycle'; state: string; detail: string | null };

export interface PrivateOperationalEvent {
  kind: string;
  visible?: boolean;
  text?: unknown;
  sessionRef?: unknown;
  parentSessionRef?: unknown;
  role?: unknown;
  state?: unknown;
  label?: unknown;
  status?: unknown;
  path?: unknown;
  name?: unknown;
  operation?: unknown;
  summary?: unknown;
  detail?: unknown;
  input?: unknown;
  result?: unknown;
  environment?: unknown;
  reasoning?: unknown;
}

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_TOOL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function text(value: unknown, max = 8_000): string | null {
  if (typeof value !== 'string') return null;
  return redactSensitiveText(value).slice(0, max);
}

function path(value: unknown): string | null {
  if (typeof value !== 'string' || value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:\//.test(value)) return null;
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  return parts.join('/').slice(0, 2_048);
}

/** Allowlist projection. Unknown/private payload fields are ignored rather than spread. */
export function normalizeOperationalEvent(event: PrivateOperationalEvent): PublicOperationalEvent | null {
  switch (event.kind) {
    case 'message': {
      if (event.visible !== true) return null;
      const value = text(event.text);
      return value ? { kind: 'message', text: value } : null;
    }
    case 'session': {
      if (typeof event.sessionRef !== 'string' || !SAFE_REF.test(event.sessionRef)) return null;
      const parentSessionRef = event.parentSessionRef === null ? null
        : typeof event.parentSessionRef === 'string' && SAFE_REF.test(event.parentSessionRef) ? event.parentSessionRef : null;
      if (event.role !== 'manager' && event.role !== 'worker') return null;
      const state = text(event.state, 64);
      return state ? { kind: 'session', sessionRef: event.sessionRef, parentSessionRef, role: event.role, state } : null;
    }
    case 'command': {
      const label = text(event.label, 256);
      if (!label || !['started', 'succeeded', 'failed'].includes(String(event.status))) return null;
      return { kind: 'command', label, status: event.status as 'started' | 'succeeded' | 'failed', path: path(event.path) };
    }
    case 'tool': {
      if (typeof event.name !== 'string' || !SAFE_TOOL.test(event.name) || !['started', 'succeeded', 'failed'].includes(String(event.status))) return null;
      return { kind: 'tool', name: event.name, status: event.status as 'started' | 'succeeded' | 'failed' };
    }
    case 'file': {
      const safePath = path(event.path);
      if (!safePath || !['read', 'created', 'modified', 'deleted'].includes(String(event.operation))) return null;
      return { kind: 'file', path: safePath, operation: event.operation as 'read' | 'created' | 'modified' | 'deleted' };
    }
    case 'diff': {
      const safePath = path(event.path);
      const summary = text(event.summary, 4_000);
      return safePath && summary ? { kind: 'diff', path: safePath, summary } : null;
    }
    case 'checkpoint': {
      const name = text(event.name, 128);
      if (!name || !['reached', 'released', 'blocked'].includes(String(event.state))) return null;
      return { kind: 'checkpoint', name, state: event.state as 'reached' | 'released' | 'blocked' };
    }
    case 'lifecycle': {
      const state = text(event.state, 64);
      return state ? { kind: 'lifecycle', state, detail: text(event.detail, 1_000) } : null;
    }
    default:
      return null;
  }
}

