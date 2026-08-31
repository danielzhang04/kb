import { projectStepDag, type StepEvent } from '../../server/entities/project.ts';

/** Project one Run's immutable stages into the same step-DAG vocabulary used by Workflow detail. */
export function stepDagFromRun(detail: { stages: Array<{ stageRef: string; stageId: string; title: string; dependsOn: string[] }> }, events: StepEvent[]) {
  const stageRefById = new Map(detail.stages.map((stage) => [stage.stageId, stage.stageRef]));
  return projectStepDag({
    stages: detail.stages.map((stage) => ({
      stageRef: stage.stageRef,
      label: stage.title,
      dependsOn: stage.dependsOn.flatMap((stageId) => {
        const stageRef = stageRefById.get(stageId);
        return stageRef === undefined ? [] : [stageRef];
      }),
    })),
    events,
  });
}
