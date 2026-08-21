import type { StepDag } from '../../server/entities/project.ts';

export function WorkflowStepGraph({
  dag,
  selectedStageRef,
  onSelectStage,
}: {
  dag: StepDag;
  selectedStageRef: string | null;
  onSelectStage: (stageRef: string | null) => void;
}): React.JSX.Element {
  return <section className="workflow-step-graph" aria-label="Workflow steps" data-testid="workflow-step-graph">
    <button type="button" aria-pressed={selectedStageRef === null} onClick={() => onSelectStage(null)}>All</button>
    {dag.nodes.map((node) => <button key={node.stageRef} type="button" aria-pressed={selectedStageRef === node.stageRef} onClick={() => onSelectStage(node.stageRef)}>{node.label}</button>)}
    <ol className="workflow-step-graph__edges" aria-label="Step dependencies">
      {dag.edges.map((edge) => <li key={`${edge.from}:${edge.to}`}>{edge.from} to {edge.to}</li>)}
    </ol>
  </section>;
}
