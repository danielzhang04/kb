/**
 * P6 W4 §3.3 — the root-owned host-node map LOADER [design:416].
 *
 * The map at `/etc/kb-dashboard/host-nodes.json` is the SOLE source of a node's `HostKind`: authorization
 * derives the host id from the map, never from the URL path or the request body. W0 owns the schema decoder
 * (`hostNodeMapContracts.ts`); this module owns the file read, the Linux ownership/permission stat, and the
 * fail-closed contract on top of it.
 *
 * FAIL CLOSED, ALWAYS THE SAME WAY. Every malformation — a bad schema literal, a non-positive revision, an
 * extra key, a missing host, a bad node-id charset, duplicate active ids, an active id also in `revoked`, a
 * malformed `revokedAt`, an unreadable file, a non-uid-0 owner on Linux, or any group/other write bit — is
 * one outcome: `{ ok: false }`. The node-authenticated routes turn that into `503 host-map-unavailable`,
 * Health shows one integrity row, and the operator surface is untouched. A bad map must never take the
 * dashboard down, and must never let a node in.
 *
 * The refusal deliberately carries NO map contents: a `503`/`403` body that echoed the file would leak the
 * enrolled node ids to an unauthenticated caller.
 */
import { readFileSync, statSync } from 'node:fs';
import { decodeHostNodeMap, type HostNodeMap } from './hostNodeMapContracts.ts';

/** The one path the map is ever read from. Root-owned `0444` on the VM. */
export const HOST_NODE_MAP_PATH = '/etc/kb-dashboard/host-nodes.json';

/** The basename Health's `host-map` integrity row reports as `owner` — never the full path. */
export const HOST_NODE_MAP_BASENAME = 'host-nodes.json';

export type HostNodeMapLoad =
  | { ok: true; map: HostNodeMap }
  | { ok: false };

/** The minimal `fs.Stats` shape the Linux ownership check reads (injected in tests). */
export interface HostNodeMapStat {
  uid: number;
  mode: number;
}

export interface HostNodeMapLoaderDeps {
  path?: string;
  /** Read the map text. Any throw (missing/unreadable file) is a fail-closed load. */
  read?: (path: string) => string;
  /** Stat the map file for the Linux ownership check. Any throw is a fail-closed load. */
  stat?: (path: string) => HostNodeMapStat;
  /** Defaults to the real platform; the stat check runs only on Linux. */
  platform?: string;
}

/** The group- and other-write bits. `0444` clears all of them; any set bit is a writable map = refusal. */
const GROUP_OTHER_WRITE = 0o022;

/**
 * Read, decode, and (on Linux) ownership-check the host-node map. Never throws: every failure — I/O, JSON,
 * schema, or a Linux ownership/permission violation — collapses to `{ ok: false }`, the single fail-closed
 * outcome the caller maps to `503 host-map-unavailable`.
 */
export function loadHostNodeMap(deps: HostNodeMapLoaderDeps = {}): HostNodeMapLoad {
  const path = deps.path ?? HOST_NODE_MAP_PATH;
  const read = deps.read ?? ((p: string) => readFileSync(p, 'utf-8'));
  const stat = deps.stat ?? ((p: string) => {
    const s = statSync(p);
    return { uid: s.uid, mode: s.mode };
  });
  const platform = deps.platform ?? process.platform;

  let map: HostNodeMap;
  try {
    map = decodeHostNodeMap(JSON.parse(read(path)));
  } catch {
    // Unreadable file, invalid JSON, or any schema malformation — all one fail-closed outcome.
    return { ok: false };
  }

  if (platform === 'linux') {
    let st: HostNodeMapStat;
    try {
      st = stat(path);
    } catch {
      return { ok: false };
    }
    // Root-owned only, and no group/other write bit: a map any non-root principal could rewrite is a map
    // that could enroll an attacker's node id, so a writable or non-root-owned map is refused outright.
    if (st.uid !== 0) return { ok: false };
    if ((st.mode & GROUP_OTHER_WRITE) !== 0) return { ok: false };
  }

  return { ok: true, map };
}
