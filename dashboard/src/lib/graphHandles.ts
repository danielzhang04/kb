/** Shared, dependency-free interaction rules for the P2 workflow step DAG. */
export function stepSelection(
  stageRef: string | null,
  selectedStageRef: string | null,
  onSelectStage: (stageRef: string | null) => void,
): { 'aria-pressed': boolean; onClick: () => void } {
  return {
    'aria-pressed': selectedStageRef === stageRef,
    onClick: () => onSelectStage(stageRef),
  };
}

export function dependencyLabel(from: string, to: string): string {
  return `${from} to ${to}`;
}
