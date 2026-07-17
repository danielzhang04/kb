import { describe, it, expect } from 'vitest';
import { drainHandle, drainAll, watchStop, Q8_GRACE_MS, Q8_ESCALATE_MS } from './stopWatch.ts';
import type { StopWatchDeps } from './stopWatch.ts';
import type { SessionHandle, SessionKind } from './index.ts';

/**
 * A fake handle that records every control call, with a knob for WHEN it goes not-live: `dieAfter`
 * counts control calls (interrupt/sigterm/sigkill) and flips `live` false once that many have landed.
 * `dieAfter: Infinity` = never dies on its own → the full ladder fires.
 */
function fakeHandle(id: string, opts: { dieAfter?: number; kind?: SessionKind } = {}): SessionHandle & {
  calls: string[];
} {
  const dieAfter = opts.dieAfter ?? Infinity;
  const h = {
    id,
    kind: opts.kind ?? ('broker-sdk' as SessionKind),
    createdAt: 0,
    live: true,
    calls: [] as string[],
    tick(action: string) {
      this.calls.push(action);
      if (this.calls.length >= dieAfter) this.live = false;
    },
    interrupt() {
      this.tick('interrupt');
    },
    sigterm() {
      this.tick('sigterm');
    },
    sigkill() {
      this.tick('sigkill');
    },
    steer() {},
  };
  return h as unknown as SessionHandle & { calls: string[] };
}

/** A fake clock + sleep: `sleep(ms)` advances the clock synchronously (no real timers). */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

describe('broker/stopWatch — active STOP drain ladder', () => {
  it('drains a stubborn live handle interrupt() -> SIGTERM -> SIGKILL in order, at the Q8 timings', async () => {
    const clock = fakeClock();
    const handle = fakeHandle('s1', { dieAfter: Infinity });
    const actions = await drainHandle(handle, clock);

    expect(actions.map((a) => a.action)).toEqual(['interrupt', 'sigterm', 'sigkill']);
    expect(actions[0].at).toBe(0);
    expect(actions[1].at).toBe(Q8_GRACE_MS); // 60_000
    expect(actions[2].at).toBe(Q8_GRACE_MS + Q8_ESCALATE_MS); // 90_000
    expect(handle.calls).toEqual(['interrupt', 'sigterm', 'sigkill']);
  });

  it('stops escalating at the rung where the handle goes not-live (interrupt took)', async () => {
    const clock = fakeClock();
    const handle = fakeHandle('s2', { dieAfter: 1 }); // dies right after interrupt()
    const actions = await drainHandle(handle, clock);
    expect(actions.map((a) => a.action)).toEqual(['interrupt']);
    expect(handle.calls).toEqual(['interrupt']); // never SIGTERM/SIGKILL a cleanly-exited session
  });

  it('SIGTERM took: escalates no further to SIGKILL', async () => {
    const clock = fakeClock();
    const handle = fakeHandle('s3', { dieAfter: 2 }); // dies after interrupt + sigterm
    const actions = await drainHandle(handle, clock);
    expect(actions.map((a) => a.action)).toEqual(['interrupt', 'sigterm']);
  });

  it('drains EVERY live handle in the table', async () => {
    const clock = fakeClock();
    const handles = [
      fakeHandle('a', { dieAfter: Infinity }),
      fakeHandle('b', { dieAfter: Infinity }),
      fakeHandle('c', { dieAfter: 1 }),
    ];
    const results = await drainAll(handles, clock);
    expect(results.get('a')!.map((x) => x.action)).toEqual(['interrupt', 'sigterm', 'sigkill']);
    expect(results.get('b')!.map((x) => x.action)).toEqual(['interrupt', 'sigterm', 'sigkill']);
    expect(results.get('c')!.map((x) => x.action)).toEqual(['interrupt']);
  });

  it('watchStop fires the drain when STOP appears via the watcher', async () => {
    const clock = fakeClock();
    const handle = fakeHandle('w1', { dieAfter: Infinity });
    let fire: () => void = () => {};
    const deps: StopWatchDeps = {
      ...clock,
      stopPresent: () => false,
      startWatch: (_root, onStop) => {
        fire = onStop;
        return { close: () => {} };
      },
    };
    watchStop('/repo', { liveHandles: () => [handle] }, deps);
    expect(handle.calls).toEqual([]); // nothing yet
    fire(); // STOP appears
    await Promise.resolve();
    await Promise.resolve();
    expect(handle.calls[0]).toBe('interrupt');
  });

  it('watchStop drains immediately if STOP is ALREADY present at (re)start', async () => {
    const clock = fakeClock();
    const handle = fakeHandle('w2', { dieAfter: Infinity });
    const deps: StopWatchDeps = {
      ...clock,
      stopPresent: () => true,
      startWatch: () => ({ close: () => {} }),
    };
    watchStop('/repo', { liveHandles: () => [handle] }, deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(handle.calls[0]).toBe('interrupt');
  });
});
