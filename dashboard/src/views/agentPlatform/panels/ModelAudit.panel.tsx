/**
 * Model Audit panel (Agent Platform, Wave-1 U9).
 *
 * ── What it is ──
 * The visible half of the INERT model-verify hook pair. `model_verify_pretooluse.js` records which
 * model each dispatch (the `Agent` tool, matched under its own name or its `Task` alias) ASKED for;
 * `model_verify_subagentstop.js` reads the finished subagent's own transcript and records which model
 * it actually RAN on. This panel is where an operator reads the resulting log.
 *
 * ── Why it exists ──
 * BOSS.md requires the model of every dispatched subagent to be verified at grading time by grepping
 * the subagent transcript — "an ungrepped grade is invalid". That check is manual, easy to skip, and
 * only ever happens after the fact. The hooks write the same evidence down automatically; this panel
 * makes a MISMATCH (asked for opus, ran on haiku) visible without opening a transcript at all.
 *
 * ── Inert on purpose, and the panel says so ──
 * Nothing in `.claude/settings*.json` registers these hooks, so on a machine that has never armed them
 * the log does not exist and this panel is EMPTY. That empty state is the expected reading, not a
 * failed fetch, so it is spelled out on screen — the arming snippet lives in
 * `docs/proposals/spawn-model-verify-hooks.md`.
 *
 * ── No timestamps per row, and that is deliberate ──
 * No hook event carries a clock, and calling Date.now() inside a hook would make its output
 * untestable, so rows carry only what their event supplied. The panel shows the LOG's last-written
 * time once, in the header, rather than inventing a time per row.
 *
 * ── Where the data comes from ──
 * `/api/model-audit`, a read-only server projection. The browser never reads a file, and no route here
 * can arm, disarm, or edit anything.
 *
 * House rules honoured: ONE entry file, its OWN stylesheet, `import type` only across the
 * client→server boundary, and zero edits to any shared file.
 */
import type { AgentPlatformPanel } from '../types';
import type { ModelAuditResponse, ModelAuditRow } from '../../../../server/modelAudit/routes';
import { localTimestampLabel } from '../../../lib/scheduleWords';
import { useReadPanel } from '../../../lib/useReadPanel';
import './ModelAudit.css';

/** A one-line gloss per verdict, so the vocabulary never needs the proposal open beside it. */
const VERDICT_HELP: Record<string, string> = {
  allowed: 'the requested model is in governance/model-routing.yaml',
  unknown: 'the requested model is NOT in the routing policy',
  unspecified: 'no model was named — routing resolves the default',
  unverified: 'not enough information to compare',
  match: 'the transcript shows the model that was asked for',
  mismatch: 'the transcript shows a DIFFERENT model than the one asked for',
};

/** A row's stable-enough identity for React. The log has no ids; index breaks ties. */
function rowKey(row: ModelAuditRow, index: number): string {
  return `${index}-${row.event ?? '?'}-${row.agent_id ?? row.subagent_type ?? ''}`;
}

function Row({ row }: { row: ModelAuditRow }): React.JSX.Element {
  const verdict = typeof row.verdict === 'string' ? row.verdict : 'unverified';
  const agent = row.agent_type ?? row.subagent_type ?? null;
  // The verdict input is the model that answered FIRST; the mention list is supplementary, and shown
  // only when it says something the primary does not (a model switch mid-run).
  const observed = row.observed_model ?? null;
  const alsoSeen = (row.observed_models ?? []).filter((m) => m !== observed);
  return (
    <li
      className={`ap-modelaudit__row ap-modelaudit__row--${verdict}`}
      data-testid={`ap-modelaudit-row-${verdict}`}
    >
      <div className="ap-modelaudit__line">
        <span className="ap-modelaudit__event">{row.event ?? 'row'}</span>
        {agent ? <span className="ap-modelaudit__agent">{agent}</span> : null}
        <span
          className={`ap-modelaudit__verdict ap-modelaudit__verdict--${verdict}`}
          title={VERDICT_HELP[verdict] ?? verdict}
        >
          {verdict}
        </span>
      </div>
      <div className="ap-modelaudit__line">
        <span className="ap-modelaudit__detail">requested</span>
        <span className="ap-modelaudit__model">{row.requested_model ?? '—'}</span>
        {observed ? (
          <>
            <span className="ap-modelaudit__detail">observed</span>
            <span className="ap-modelaudit__model">{observed}</span>
          </>
        ) : null}
        {alsoSeen.length > 0 ? (
          <span className="ap-modelaudit__detail" data-testid="ap-modelaudit-also-seen">
            also mentioned: {alsoSeen.join(', ')}
          </span>
        ) : null}
      </div>
      {row.description ? <span className="ap-modelaudit__detail">{row.description}</span> : null}
      {/* Pairing a stop row back to its dispatch is best-effort — say so rather than imply proof. */}
      {row.pairing === 'heuristic' ? (
        <span className="ap-modelaudit__detail" data-testid="ap-modelaudit-pairing">
          paired to its dispatch by session + agent type, not by a shared id
        </span>
      ) : null}
    </li>
  );
}

function ModelAuditBody(): React.JSX.Element {
  // A dead daemon is an expected input for a read-only panel: the shared hook names the state, never
  // crashes, and never invents rows.
  const { data, state } = useReadPanel<ModelAuditResponse>('/api/model-audit');

  if (state === 'loading' || state === 'idle') {
    return (
      <div className="ap-modelaudit">
        <p className="ap-modelaudit__status" data-testid="ap-modelaudit-loading">
          Reading the model audit log…
        </p>
      </div>
    );
  }

  if (state === 'unavailable') {
    return (
      <div className="ap-modelaudit">
        <p className="ap-modelaudit__status ap-modelaudit__status--error" data-testid="ap-modelaudit-unavailable">
          The model audit log could not be read. This panel reads <code>/api/model-audit</code> and
          shows nothing rather than invented rows.
        </p>
      </div>
    );
  }

  const rows = data?.rows ?? [];

  if (rows.length === 0) {
    return (
      <div className="ap-modelaudit">
        <p className="ap-modelaudit__status" data-testid="ap-modelaudit-empty">
          No audit rows — the hooks are inert until armed. Nothing in{' '}
          <code>.claude/settings.json</code> registers <code>model_verify_pretooluse.js</code> or{' '}
          <code>model_verify_subagentstop.js</code>, so no dispatch has been recorded. The snippet that
          would arm them is in <code>docs/proposals/spawn-model-verify-hooks.md</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="ap-modelaudit">
      <div className="ap-modelaudit__head">
        <span className="ap-modelaudit__status" data-testid="ap-modelaudit-summary">
          {rows.length === data?.totalRows
            ? `${data?.totalRows} rows`
            : `${rows.length} of ${data?.totalRows} rows (most recent first)`}
        </span>
        {data?.modifiedAt ? (
          <span className="ap-modelaudit__meta" data-testid="ap-modelaudit-modified">
            log last written {localTimestampLabel(data.modifiedAt)}
          </span>
        ) : null}
      </div>
      <ul className="ap-modelaudit__rows">
        {rows.map((row, index) => (
          <Row key={rowKey(row, index)} row={row} />
        ))}
      </ul>
      <p className="ap-modelaudit__note" data-testid="ap-modelaudit-note">
        <strong>A mismatch is a prompt to look, never proof.</strong> Stop rows are matched back to a
        dispatch by session and agent type — there is no shared id — so concurrent dispatches of the
        same agent type can pair the wrong two. Open the transcript before concluding anything.
      </p>
      <p className="ap-modelaudit__note">
        Read-only and report-only. The hooks never block a dispatch — an <code>unknown</code> model is
        recorded, not refused. Rows carry no timestamp on purpose: no hook event supplies one, and a
        clock inside a hook would make its output untestable.
      </p>
    </div>
  );
}

export const panel: AgentPlatformPanel = {
  id: 'model-audit',
  order: 80,
  title: 'Model Audit',
  description:
    'Requested-vs-observed subagent models, as the inert PreToolUse / SubagentStop verify hooks would record them.',
  render: () => <ModelAuditBody />,
};
