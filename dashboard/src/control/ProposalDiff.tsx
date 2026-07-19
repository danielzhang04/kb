import type { JsonValue, ProposalDiffDto } from './controlClient';

export interface ProposalDiffProps {
  diff: ProposalDiffDto;
}

function renderValue(value: JsonValue | undefined): string {
  return value === undefined ? 'not present' : JSON.stringify(value, null, 2);
}

export function ProposalDiff({ diff }: ProposalDiffProps) {
  if (!diff.changed) {
    return <p className="control-diff__empty">No material changes from the prior revision.</p>;
  }

  return (
    <section className="control-diff" aria-label="Proposal changes">
      <h3>Revision changes</h3>
      <ol className="control-diff__list">
        {diff.changes.map((change, index) => (
          <li className="control-diff__change" key={`${change.path}-${index}`}>
            <code className="mc-mono control-diff__path">{change.path}</code>
            <div className="control-diff__values">
              <div>
                <span className="control-label">Before</span>
                <pre>{renderValue(change.before)}</pre>
              </div>
              <div>
                <span className="control-label">After</span>
                <pre>{renderValue(change.after)}</pre>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
