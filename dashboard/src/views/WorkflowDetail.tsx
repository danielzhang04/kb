import { useState } from 'react';
import type { EntityDetail } from '../../server/entities/contracts.ts';
import type { RunRow } from '../../server/control/p2Contracts.ts';
import { outputHref } from '../../server/entities/outputs.ts';
import { AdvancedDisclosure } from '../entity/AdvancedDisclosure';
import { WorkflowStepGraph } from '../entity/WorkflowStepGraph';
import { stepDagFromRun } from '../control/runGraph';
import type { NavTarget } from '../nav/stack';
import '../styles/views/entity.css';
import '../styles/views/workflows.css';

function runText(run: RunRow): string {
  return `${run.title} \u00b7 ${run.outcome ?? run.lifecycle}`;
}

export type WorkflowDetailSurface = 'live' | 'brief';

function elapsed(ms = 0): string { return `${Math.max(0, Math.round(ms / 1000))}s`; }

export interface WorkflowDetailBodyProps {
  detail: EntityDetail;
  surface?: WorkflowDetailSurface;
  onOpenRun?: (runRef: string) => void;
  onNavigate?: (target: NavTarget) => void;
}

/** Pure P2 workflow body: server-projected Run rows plus the workflow's step DAG, with no console join. */
export function WorkflowDetailBody({ detail, surface = 'live', onOpenRun, onNavigate }: WorkflowDetailBodyProps): React.JSX.Element {
  const [selectedStageRef, setSelectedStageRef] = useState<string | null>(null);
  if (surface === 'brief') {
    const brief = detail.brief;
    return <div className="entity-brief" data-testid="workflow-brief">
      <p>{brief.purpose}</p>
      <p>{brief.doingNow}</p>
      <p>{brief.autonomyTier}. {brief.pendingGates} pending {brief.pendingGates === 1 ? 'gate' : 'gates'}.</p>
      <p>{brief.schedule ? `Next scheduled ${brief.schedule.nextAt}.` : 'No schedule.'}</p>
      <h3>Recent runs</h3>
      {brief.recentRuns.length ? <ul className="entity-list">{brief.recentRuns.map((run) => <li key={run.runRef}>
        <button type="button" className="entity-row entity-row--link" onClick={() => { onOpenRun?.(run.runRef); onNavigate?.({ view: 'workflows', focus: { kind: 'run', id: run.runRef } }); }}>{runText(run)}</button>
      </li>)}</ul> : <p>No runs yet</p>}
      <h3>Recent outputs</h3>
      {brief.outputs.length ? <ul>{brief.outputs.map((output) => <li key={`${output.kind}:${output.label}`}><a href={outputHref(output)}>{output.label}</a></li>)}</ul> : <p>No recent outputs</p>}
    </div>;
  }

  const workflow = detail.details.workflow;
  const runGraph = workflow?.runGraph ?? null;
  const projected = runGraph ? stepDagFromRun({ stages: runGraph.stages }, runGraph.events) : null;
  const dag = projected ? { nodes: projected.nodes, edges: projected.edges } : workflow?.stepDag ?? { nodes: [], edges: [] };
  const selectedEvents = projected?.eventsFor(selectedStageRef) ?? [];
  return <div className="workflow-live" data-testid="workflow-live">
    <p className="entity-prose" data-testid="workflow-summary">{detail.brief.purpose}</p>
    {detail.summary.activeRuns.length ? <ul className="entity-list">{detail.summary.activeRuns.map((run) => <li key={run.runRef}>
      <button type="button" className="entity-row entity-row--link" onClick={() => { onOpenRun?.(run.runRef); onNavigate?.({ view: 'workflows', focus: { kind: 'run', id: run.runRef } }); }}>
        <span className="entity-row__main">{runText(run)} {'\u00b7'} {elapsed(run.elapsedMs)} {'\u00b7'} {run.toolsCalled ?? 0} tools {'\u00b7'} {run.lastLine ?? run.lifecycle}{run.gateBadge ? ` \u00b7 ${run.gateBadge}` : ''}</span>
      </button>
    </li>)}</ul> : <p className="entity-note">{detail.summary.temporalLabel}</p>}
    <AdvancedDisclosure accessibleLabel="Advanced workflow steps">
      {dag.nodes.length ? <WorkflowStepGraph dag={dag} selectedStageRef={selectedStageRef} onSelectStage={setSelectedStageRef} /> : <p className="entity-note">This workflow has no steps yet.</p>}
      {runGraph ? <section aria-label="Selected step activity"><h3>Activity</h3>{selectedEvents.length ? <ol>{selectedEvents.map((event) => <li key={event.cursor}>{'summary' in event && typeof event.summary === 'string' ? event.summary : `Event ${event.cursor}`}</li>)}</ol> : <p>No activity for this step.</p>}</section> : null}
    </AdvancedDisclosure>
  </div>;
}

export function WorkflowTechnicalDetails({ detail }: { detail: EntityDetail }): React.JSX.Element {
  const values: Array<[string, string]> = [
    ['Source', detail.details.sourcePath], ['Revision', detail.details.sourceRevision],
    ['Tools', detail.details.tools.join(', ') || 'None declared'], ['Declared ceiling', detail.details.declaredCeiling],
    ['Knowledge', detail.details.knowledgeSources.join(', ') || 'None'], ['Schemas', detail.details.schemas.join(', ') || 'None'],
    ['Lineage', detail.details.lineage.join(', ') || 'None'], ['Grades', detail.details.grades.join(', ') || 'None'],
    ['IDs', detail.details.ids.join(', ') || 'None'],
  ];
  return <dl className="entity-technical-list">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mc-mono">{value}</dd></div>)}</dl>;
}
