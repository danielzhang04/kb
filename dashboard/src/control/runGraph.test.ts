import { describe, expect, it } from 'vitest';
import type { RunDetailDto } from './controlClient';
import { stepDagFromRun } from './runGraph';

describe('stepDagFromRun', () => {
  it('maps stage ids to immutable refs and filters one ordered event source', () => {
    const detail = { stages: [
      { stageId: 'draft', stageRef: 'stage-1', title: 'Draft', dependsOn: [] },
      { stageId: 'review', stageRef: 'stage-2', title: 'Review', dependsOn: ['draft'] },
    ] } as unknown as Pick<RunDetailDto, 'stages'>;
    const events = [{ stageRef: 'stage-1', cursor: 1 }, { stageRef: 'stage-2', cursor: 2 }];
    const dag = stepDagFromRun(detail, events);
    expect(dag.nodes).toEqual([{ stageRef: 'stage-1', label: 'Draft' }, { stageRef: 'stage-2', label: 'Review' }]);
    expect(dag.edges).toEqual([{ from: 'stage-1', to: 'stage-2' }]);
    expect(dag.eventsFor('stage-2')).toEqual([{ stageRef: 'stage-2', cursor: 2 }]);
  });
});
