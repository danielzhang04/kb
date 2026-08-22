import { dependencyLabel, stepSelection } from '../lib/graphHandles';

export interface WorkflowStepDag {
  nodes: Array<{ stageRef: string; label: string }>;
  edges: Array<{ from: string; to: string }>;
}

export function WorkflowStepGraph({
  dag,
  selectedStageRef,
  onSelectStage,
}: {
  dag: WorkflowStepDag;
  selectedStageRef: string | null;
  onSelectStage: (stageRef: string | null) => void;
}): React.JSX.Element {
  return <section className="workflow-step-graph" aria-label="Workflow steps" data-testid="workflow-step-graph">
    <button type="button" {...stepSelection(null, selectedStageRef, onSelectStage)}>All</button>
    {dag.nodes.map((node) => <button key={node.stageRef} type="button" {...stepSelection(node.stageRef, selectedStageRef, onSelectStage)}>{node.label}</button>)}
    <ol className="workflow-step-graph__edges" aria-label="Step dependencies">
      {dag.edges.map((edge) => <li key={`${edge.from}:${edge.to}`}>{dependencyLabel(edge.from, edge.to)}</li>)}
    </ol>
  </section>;
}
