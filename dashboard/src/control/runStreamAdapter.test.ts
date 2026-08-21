import { describe, expect, it } from 'vitest';
import { RUN_LIFECYCLE_FIXTURE } from './__fixtures__/runLifecycle';
import { replayRunLifecycle } from './runStreamAdapter';

describe('runStreamAdapter', () => {
  it('partitioned reconnect at three cut points equals full replay and unknown events become safe rows', () => {
    const events = RUN_LIFECYCLE_FIXTURE;
    const replay = replayRunLifecycle(events);

    for (const cut of [1, 2, 3]) {
      const partitioned = [...events.slice(0, cut), ...events.slice(cut - 1)];
      expect(replayRunLifecycle(partitioned), `cut ${cut}`).toEqual(replay);
    }
    expect(replay.map((row) => row.cursor)).toEqual([1, 2, 3, 4]);
    expect(replay[1]).toMatchObject({ label: 'Read', status: 'success', toolName: 'Read' });
    expect(replay[1]).not.toHaveProperty('toolUseId');
    expect(replay[1]).not.toHaveProperty('toolResultId');
    expect(replay[3]).toMatchObject({ label: 'future-signal', source: 'system', status: null });
  });
});
