import { useState } from 'react';
import type { OutputRef } from '../../server/control/p2Contracts.ts';
import type { HumanRequest, HumanRequestDecision } from '../../server/control/types.ts';

type OperatorDecision = Exclude<HumanRequestDecision, 'auto-closed'>;

export interface RunInspectorDetails {
  stepSkeleton: string;
  envelope: string;
  linkedCards: readonly string[];
  evidence: readonly string[];
  ids: readonly string[];
}

export interface RunInspectorResponse {
  requestRef: string;
  expectedRevision: number;
  decision: OperatorDecision;
  response: string | null;
}

export interface RunInspectorProps {
  plan: string;
  milestones: readonly string[];
  outputs: readonly OutputRef[];
  gate: HumanRequest | null;
  ceremonyAvailable: boolean;
  details: RunInspectorDetails;
  busy?: boolean;
  onRespond(input: RunInspectorResponse): void | Promise<void>;
}

function isT3(gate: HumanRequest): boolean {
  return gate.kind === 'approval' || gate.kind === 'review' || gate.kind === 'governance-refusal';
}

function outputLabel(output: OutputRef): string {
  if (output.kind === 'external-pr') return `${output.label} · ${output.owner}/${output.repository}#${output.number}`;
  return `${output.label} · ${output.path}`;
}

export function RunInspector(props: RunInspectorProps): React.JSX.Element {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [response, setResponse] = useState('');
  const [submittedGate, setSubmittedGate] = useState<string | null>(null);
  const gate = props.gate;
  const gateKey = gate ? `${gate.requestRef}:${gate.revision}` : null;
  const unavailableT3 = gate !== null && isT3(gate) && !props.ceremonyAvailable;
  const disabled = props.busy === true || gate === null || gate.state !== 'open'
    || submittedGate === gateKey || unavailableT3;

  const submit = (decision: OperatorDecision): void => {
    if (!gate || disabled) return;
    setSubmittedGate(gateKey);
    void props.onRespond({
      requestRef: gate.requestRef,
      expectedRevision: gate.revision,
      decision,
      response: response.trim() || null,
    });
  };

  return <aside aria-label="Run inspector">
    <section><h2>Plan</h2><p>{props.plan}</p></section>
    <section><h2>Milestones</h2><ul>{props.milestones.map((item) => <li key={item}>{item}</li>)}</ul></section>
    <section><h2>Built</h2><ul>{props.outputs.map((item) => <li key={`${item.kind}:${outputLabel(item)}`}>{outputLabel(item)}</li>)}</ul></section>
    <section>
      <h2>Gate</h2>
      {gate ? <>
        <h3>{gate.title}</h3>
        <p>{gate.prompt}</p>
        <label>Response<textarea aria-label="Response" value={response} disabled={disabled} onChange={(event) => setResponse(event.target.value)} /></label>
        {unavailableT3 ? <p role="status">Passkey ceremony unavailable</p> : null}
        {gate.kind === 'input' || gate.kind === 'intervention'
          ? <button type="button" disabled={disabled} onClick={() => submit('responded')}>Respond</button>
          : <>
              <button type="button" disabled={disabled} onClick={() => submit('approved')}>Approve</button>
              <button type="button" disabled={disabled} onClick={() => submit(gate.kind === 'review' ? 'changes-requested' : 'rejected')}>
                {gate.kind === 'review' ? 'Request changes' : 'Reject'}
              </button>
            </>}
      </> : <p>No active gate.</p>}
    </section>
    <section>
      <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((value) => !value)}>Details</button>
      {detailsOpen ? <div>
        <p>{props.details.stepSkeleton}</p>
        <p>{props.details.envelope}</p>
        <ul>{props.details.linkedCards.map((item) => <li key={item}>{item}</li>)}</ul>
        <ul>{props.details.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
        <ul>{props.details.ids.map((item) => <li key={item}>{item}</li>)}</ul>
      </div> : null}
    </section>
  </aside>;
}
