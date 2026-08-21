import { describe, expect, it } from 'vitest';
import { RUN_LIFECYCLE_FIXTURE } from './__fixtures__/runLifecycle';
import { appendRunLifecycle, replayRunLifecycle } from './runStreamAdapter';

describe('runStreamAdapter', () => {
  it('full replay equals incremental reconnect and unknown events become safe lifecycle rows', () => {
    const events = RUN_LIFECYCLE_FIXTURE;

    const replay = replayRunLifecycle(events);
    const reconnect = appendRunLifecycle(appendRunLifecycle([], events.slice(0, 2)), events.slice(1));

    expect(reconnect).toEqual(replay);
    expect(replay.map((row) => row.cursor)).toEqual([1, 2, 3]);
    expect(replay[1]).toMatchObject({ label: 'Read', status: 'success', toolName: 'Read' });
    expect(replay[1]).not.toHaveProperty('toolUseId');
    expect(replay[1]).not.toHaveProperty('toolResultId');
  });
});
