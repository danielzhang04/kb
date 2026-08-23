import { useState } from 'react';
import type { OutputRef } from '../../server/control/p2Contracts.ts';
import type { HumanRequestDecision } from '../../server/control/types.ts';

type OperatorDecision = Exclude<HumanRequestDecision, 'auto-closed'>;

export interface RunInspectorGate {
  requestRef: string;
  revision: number;
  state: 'open' | 'resolved';
  kind: 'input' | 'approval' | 'review' | 'intervention' | 'governance-refusal';
  title: string;
  prompt: string;
}

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
  gate: RunInspectorGate | null;
  additionalGates?: readonly RunInspectorGate[];
  ceremonyAvailable: boolean;
  details: RunInspectorDetails;
  busy?: boolean;
  onRespond(input: RunInspectorResponse): void | Promise<void>;
}

function isT3(gate: RunInspectorGate): boolean {
  return gate.kind === 'approval' || gate.kind === 'review' || gate.kind === 'governance-refusal';
}

function outputLabel(output: OutputRef): string {
  if (output.kind === 'external-pr') return `${output.label} · ${output.owner}/${output.repository}#${output.number}`;
  return `${output.label} · ${output.path}`;
}

export function RunInspector(props: RunInspectorProps): React.JSX.Element {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const gates = props.gate === null ? [] : [props.gate, ...(props.additionalGates ?? [])];

  return <div className="run-v3__inspector-content">
    <section><h2>Plan</h2><p>{props.plan}</p></section>
    <section><h2>Milestones</h2><ul>{props.milestones.map((item) => <li key={item}>{item}</li>)}</ul></section>
    <section><h2>Built</h2><ul>{props.outputs.map((item) => <li key={`${item.kind}:${outputLabel(item)}`}>{outputLabel(item)}</li>)}</ul></section>
    <section>
      <h2>Gate</h2>
      {gates.length > 0
        ? <ul>{gates.map((gate) => <li key={`${gate.requestRef}:${gate.revision}`}>
            <GateControl
              gate={gate}
              ceremonyAvailable={props.ceremonyAvailable}
              busy={props.busy === true}
              onRespond={props.onRespond}
            />
          </li>)}</ul>
        : <p>No active gate.</p>}
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
  </div>;
}

interface GateControlProps {
  gate: RunInspectorGate;
  ceremonyAvailable: boolean;
  busy: boolean;
  onRespond(input: RunInspectorResponse): void | Promise<void>;
}

function GateControl(props: GateControlProps): React.JSX.Element {
  const [response, setResponse] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [responseError, setResponseError] = useState<string | null>(null);
  const gate = props.gate;
  const unavailableT3 = isT3(gate) && !props.ceremonyAvailable;
  const disabled = props.busy || gate.state !== 'open' || submitted || unavailableT3;

  const submit = (decision: OperatorDecision): void => {
    if (disabled) return;
    setSubmitted(true);
    setResponseError(null);
    void Promise.resolve(props.onRespond({
      requestRef: gate.requestRef,
      expectedRevision: gate.revision,
      decision,
      response: response.trim() || null,
    })).catch((cause: unknown) => {
      setSubmitted(false);
      setResponseError(cause instanceof Error ? cause.message : 'Response failed');
    });
  };

  return <>
        <h3>{gate.title}</h3>
        <p>{gate.prompt}</p>
        <label>Response<textarea aria-label="Response" value={response} disabled={disabled} onChange={(event) => setResponse(event.target.value)} /></label>
        {unavailableT3 ? <p role="status">Passkey ceremony unavailable</p> : null}
        {responseError ? <p role="alert">Response failed: {responseError}</p> : null}
        {gate.kind === 'input' || gate.kind === 'intervention'
          ? <button type="button" disabled={disabled} onClick={() => submit('responded')}>Respond</button>
          : <>
              <button type="button" disabled={disabled} onClick={() => submit('approved')}>Approve</button>
              <button type="button" disabled={disabled} onClick={() => submit(gate.kind === 'review' ? 'changes-requested' : 'rejected')}>
                {gate.kind === 'review' ? 'Request changes' : 'Reject'}
              </button>
            </>}
      </>;
}
