/**
 * Task 7 — Atlas panel route. Read-only projection of the voice worker's `/state` surface
 * (design §3, fetched via an INJECTED fetch — the claudeWorkerAdapter DI precedent — so no live
 * worker and no real port is ever touched), the transcript ledger under
 * `orgs/atlas/output/transcripts/`, and the `atlas`-project queue cards. Unreachable / timeout /
 * malformed worker → an explicit `{ state: "OFFLINE", lastHeartbeat }` shape, never a 500, never blank.
 */
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { fetchWorkerState, readTranscriptHistory, readAtlasCards, buildAtlasPanel } from './atlas.ts';
import type { FetchLike } from './atlas.ts';
import { registerAtlasPanel } from './routes.ts';

/**
 * A dedicated fixture root for the Atlas panel. It is deliberately NOT the shared `repo-a` fixture:
 * `repo-a`'s card count is asserted verbatim by `dag/routes.test.ts` (hardcoded 7) and other suites,
 * so injecting atlas cards there would break out-of-scope tests. This root carries the atlas cards,
 * one non-atlas card, and the transcript ledger the panel reads.
 */
const REPO_ATLAS = fileURLToPath(new URL('../__fixtures__/repo-atlas/', import.meta.url));

/** A design-§3 healthy `/state` payload. */
const HEALTHY = {
  version: 1,
  state: 'LISTENING',
  since: '2026-07-20T09:00:00Z',
  heartbeat: '2026-07-20T09:00:05Z',
  session_id: 'sess-newer',
  voice: 'mars',
  transcript: [{ t: '2026-07-20T09:00:00Z', role: 'user', text: 'hey atlas' }],
  filed_cards: [{ id: 'atlas001-0001', action: 'check the faceless renderer', state: 'inbox' }],
};

/** An injected fetch that returns `body` as a healthy 200 JSON response. */
function okFetch(body: unknown): FetchLike {
  return async () => ({ ok: true, json: async () => body });
}

describe('fetchWorkerState', () => {
  it('passes the worker /state JSON through verbatim when healthy', async () => {
    const worker = await fetchWorkerState({ fetchImpl: okFetch(HEALTHY) });
    expect(worker).toEqual(HEALTHY);
  });

  it('returns OFFLINE (never throws) when the fetch rejects', async () => {
    const reject: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const worker = await fetchWorkerState({ fetchImpl: reject });
    expect(worker).toEqual({ state: 'OFFLINE', lastHeartbeat: null });
  });

  it('returns OFFLINE when the fetch hangs past the timeout', async () => {
    const hang: FetchLike = () => new Promise(() => {}); // never settles
    const worker = await fetchWorkerState({ fetchImpl: hang, timeoutMs: 15 });
    expect(worker).toEqual({ state: 'OFFLINE', lastHeartbeat: null });
  });

  it('returns OFFLINE (no throw) when the worker body is malformed JSON', async () => {
    const badJson: FetchLike = async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });
    const worker = await fetchWorkerState({ fetchImpl: badJson });
    expect(worker).toEqual({ state: 'OFFLINE', lastHeartbeat: null });
  });

  it('returns OFFLINE when the worker body is not a JSON object', async () => {
    const worker = await fetchWorkerState({ fetchImpl: okFetch('not-an-object') });
    expect(worker).toEqual({ state: 'OFFLINE', lastHeartbeat: null });
  });

  it('returns OFFLINE when the worker responds non-ok', async () => {
    const notOk: FetchLike = async () => ({ ok: false, json: async () => HEALTHY });
    const worker = await fetchWorkerState({ fetchImpl: notOk });
    expect(worker).toEqual({ state: 'OFFLINE', lastHeartbeat: null });
  });

  it('carries the last-known heartbeat into the OFFLINE shape', async () => {
    const reject: FetchLike = async () => {
      throw new Error('down');
    };
    const worker = await fetchWorkerState({ fetchImpl: reject, lastHeartbeat: '2026-07-20T09:00:05Z' });
    expect(worker).toEqual({ state: 'OFFLINE', lastHeartbeat: '2026-07-20T09:00:05Z' });
  });
});

describe('readTranscriptHistory', () => {
  it('reads fixture transcripts newest-first, parsing rows and skipping malformed lines', () => {
    const history = readTranscriptHistory(REPO_ATLAS);
    expect(history.map((h) => h.file)).toEqual([
      '2026-07-20-sess-newer.jsonl',
      '2026-07-19-sess-older.jsonl',
    ]);
    const newer = history[0];
    expect(newer.date).toBe('2026-07-20');
    expect(newer.sessionId).toBe('sess-newer');
    // 3 physical lines, 1 malformed → 2 parsed rows.
    expect(newer.lines).toHaveLength(2);
    expect(newer.lines[0]).toEqual({
      t: '2026-07-20T09:00:00Z',
      role: 'user',
      text: 'file a card to check the faceless renderer',
    });
    expect(history[1].lines).toHaveLength(2);
  });

  it('is bounded to the last 10 sessions (newest kept)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-tx-'));
    const txDir = join(dir, 'orgs', 'atlas', 'output', 'transcripts');
    mkdirSync(txDir, { recursive: true });
    for (let i = 0; i < 12; i += 1) {
      const day = String(i + 1).padStart(2, '0');
      writeFileSync(
        join(txDir, `2026-07-${day}-sess-${i}.jsonl`),
        `{"t":"2026-07-${day}T00:00:00Z","role":"user","text":"hi ${i}"}\n`,
      );
    }
    const history = readTranscriptHistory(dir);
    expect(history).toHaveLength(10);
    // Newest first, oldest two (days 01 and 02) dropped.
    expect(history[0].file).toBe('2026-07-12-sess-11.jsonl');
    expect(history.at(-1)!.file).toBe('2026-07-03-sess-2.jsonl');
  });

  it('degrades to [] when the transcripts dir is missing', () => {
    const bare = mkdtempSync(join(tmpdir(), 'atlas-bare-'));
    expect(readTranscriptHistory(bare)).toEqual([]);
  });
});

describe('readAtlasCards', () => {
  it('returns only project:atlas cards across queue states', () => {
    const cards = readAtlasCards(REPO_ATLAS);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.id !== '')).toBe(true);
    const atlas = cards.find((c) => c.id === 'atlas001-0001')!;
    expect(atlas).toEqual({
      id: 'atlas001-0001',
      action: 'check the faceless renderer',
      state: 'inbox',
      workflow: 'atlas-voice',
    });
    // Cards are collected across queue states, not just inbox.
    expect(cards.map((c) => c.state).sort()).toEqual(['inbox', 'working']);
    expect(cards.find((c) => c.id === 'atlas001-0002')?.workflow).toBe('atlas-v1');
    // The non-atlas (project: kb) fixture card is excluded.
    expect(cards.some((c) => c.id === 'kb000001-0001')).toBe(false);
  });
});

describe('buildAtlasPanel', () => {
  it('assembles worker + history + cards', async () => {
    const panel = await buildAtlasPanel(REPO_ATLAS, { fetchImpl: okFetch(HEALTHY) });
    expect(panel.worker).toEqual(HEALTHY);
    expect(panel.history[0].file).toBe('2026-07-20-sess-newer.jsonl');
    expect(panel.cards.some((c) => c.id === 'atlas001-0001')).toBe(true);
    expect(panel.rejectedCards).toBe(0);
  });

  it('counts and warns for malformed queue cards while retaining valid Atlas cards', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'atlas-rejected-'));
    cpSync(REPO_ATLAS, repo, { recursive: true });
    const malformed = join(repo, 'queue', 'inbox', 'malformed.md');
    writeFileSync(malformed, 'not frontmatter', 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const panel = await buildAtlasPanel(repo, { fetchImpl: okFetch(HEALTHY) });
      expect(panel.rejectedCards).toBe(1);
      expect(panel.cards.some((c) => c.id === 'atlas001-0001')).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(malformed));
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/frontmatter/i));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('registerAtlasPanel (GET /api/panels/atlas)', () => {
  it('serves the healthy passthrough with history + cards', async () => {
    const app = Fastify({ logger: false });
    registerAtlasPanel(app, REPO_ATLAS, { fetchImpl: okFetch(HEALTHY) });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/panels/atlas' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { worker: Record<string, unknown>; history: unknown[]; cards: { id: string }[] };
    expect(body.worker.state).toBe('LISTENING');
    expect(Array.isArray(body.history)).toBe(true);
    expect(body.cards.some((c) => c.id === 'atlas001-0001')).toBe(true);

    await app.close();
  });

  it('serves an explicit OFFLINE worker (never a 500) when the worker is down', async () => {
    const down: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const app = Fastify({ logger: false });
    registerAtlasPanel(app, REPO_ATLAS, { fetchImpl: down });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/panels/atlas' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { worker: { state: string; lastHeartbeat: string | null } };
    expect(body.worker.state).toBe('OFFLINE');
    expect(body.worker.lastHeartbeat).toBeNull();

    await app.close();
  });

  it('remembers the last-known heartbeat across requests when the worker drops', async () => {
    let up = true;
    const flappy: FetchLike = async () => {
      if (up) return { ok: true, json: async () => HEALTHY };
      throw new Error('down');
    };
    const app = Fastify({ logger: false });
    registerAtlasPanel(app, REPO_ATLAS, { fetchImpl: flappy });
    await app.ready();

    const first = (await app.inject({ method: 'GET', url: '/api/panels/atlas' })).json() as { worker: Record<string, unknown> };
    expect(first.worker.heartbeat).toBe('2026-07-20T09:00:05Z');

    up = false;
    const second = (await app.inject({ method: 'GET', url: '/api/panels/atlas' })).json() as {
      worker: { state: string; lastHeartbeat: string | null };
    };
    expect(second.worker.state).toBe('OFFLINE');
    expect(second.worker.lastHeartbeat).toBe('2026-07-20T09:00:05Z');

    await app.close();
  });
});
