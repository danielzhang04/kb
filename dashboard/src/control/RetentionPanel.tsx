import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  dryRunQuarantine,
  getRetentionInventory,
  quarantineRuns,
  restoreRun,
  type FetchLike,
  type QuarantinePlanDto,
  type StorageInventoryDto,
  type StorageInventoryItemDto,
} from './controlClient';

const CANDIDATE_STATES = new Set<StorageInventoryItemDto['state']>(['succeeded', 'failed', 'stopped', 'interrupted']);

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KiB`;
  return `${(value / (1_024 * 1_024)).toFixed(1)} MiB`;
}

export interface RetentionPanelProps {
  token: string;
  fetchImpl?: FetchLike;
  onChanged?: () => void | Promise<void>;
}

/** Reversible retention controls only. There is intentionally no purge operation. */
export function RetentionPanel({ token, fetchImpl, onChanged }: RetentionPanelProps): React.JSX.Element {
  const [inventory, setInventory] = useState<StorageInventoryDto | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [plan, setPlan] = useState<QuarantinePlanDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setPlan(null);
    const next = await getRetentionInventory(token, fetchImpl);
    setInventory(next);
    setSelected((current) => current.filter((runRef) => next.activeRuns.some((run) => run.runRef === runRef)));
  }, [fetchImpl, token]);

  useEffect(() => {
    let alive = true;
    setInventory(null);
    setSelected([]);
    setPlan(null);
    setError(null);
    getRetentionInventory(token, fetchImpl)
      .then((next) => { if (alive) setInventory(next); })
      .catch((cause: unknown) => { if (alive) setError(cause instanceof Error ? cause.message : 'Could not load retention inventory.'); });
    return () => { alive = false; };
  }, [fetchImpl, token]);

  const candidates = useMemo(
    () => inventory?.activeRuns.filter((run) => CANDIDATE_STATES.has(run.state)) ?? [],
    [inventory],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const planCanCommit = plan !== null && plan.items.length > 0 && plan.items.every((item) => item.eligible);

  const toggle = (runRef: string): void => {
    setSelected((current) => current.includes(runRef) ? current.filter((value) => value !== runRef) : [...current, runRef]);
    setPlan(null);
    setError(null);
  };

  const review = async (): Promise<void> => {
    if (busy || selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(await dryRunQuarantine(selected, token, fetchImpl));
    } catch (cause) {
      setPlan(null);
      setError(cause instanceof Error ? cause.message : 'Could not prepare a quarantine review.');
    } finally { setBusy(false); }
  };

  const quarantine = async (): Promise<void> => {
    if (busy || !planCanCommit || !plan) return;
    setBusy(true);
    setError(null);
    let committed = false;
    try {
      await quarantineRuns(plan.items.map((item) => item.runRef), plan.planHash, token, fetchImpl);
      committed = true;
      setSelected([]);
      setPlan(null);
      await load();
      await onChanged?.();
    } catch (cause) {
      setPlan(null);
      setError(committed
        ? 'Quarantine committed, but the refreshed inventory could not be loaded.'
        : cause instanceof Error ? cause.message : 'Quarantine was refused; review a fresh plan.');
    } finally { setBusy(false); }
  };

  const restore = async (runRef: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    let committed = false;
    try {
      await restoreRun(runRef, token, fetchImpl);
      committed = true;
      await load();
      await onChanged?.();
    } catch (cause) {
      setError(committed
        ? 'Restore committed, but the refreshed inventory could not be loaded.'
        : cause instanceof Error ? cause.message : 'Restore was refused.');
    } finally { setBusy(false); }
  };

  const refresh = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not refresh retention inventory.');
    } finally { setBusy(false); }
  };

  return (
    <details className="control-retention">
      <summary>
        Retention &amp; quarantine
        {inventory ? <span>{formatBytes(inventory.estimatedBytes)} tracked</span> : null}
      </summary>
      <div className="control-retention__body">
        <p className="control-help">Quarantine is reversible. The server rechecks the full run bundle after review. Purge is unavailable.</p>
        {error ? <p role="alert" className="control-managed-runs__error">{error}</p> : null}
        {!inventory ? <p className="control-help">Loading storage inventory…</p> : null}
        {inventory && candidates.length > 0 ? (
          <fieldset disabled={busy}>
            <legend>Terminal run candidates</legend>
            {candidates.map((run) => (
              <label key={run.runRef}>
                <input
                  type="checkbox"
                  checked={selectedSet.has(run.runRef)}
                  onChange={() => toggle(run.runRef)}
                />
                <span><strong>{run.title}</strong> · {run.state} · {formatBytes(run.estimatedBytes)}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {inventory && candidates.length === 0 ? <p className="control-help">No terminal runs are candidates for quarantine.</p> : null}
        <div className="control-actions">
          <button type="button" className="mc-btn" disabled={busy || selected.length === 0} onClick={() => void review()}>
            Review selected
          </button>
          <button type="button" className="mc-btn" disabled={busy} onClick={() => void refresh()}>Refresh inventory</button>
        </div>
        {plan ? (
          <div className="control-retention__plan" aria-label="Quarantine review">
            <strong>Dry-run review</strong>
            <ul>
              {plan.items.map((item) => (
                <li key={item.runRef}>
                  <span>{item.title}</span>
                  <span>{item.eligible ? 'Ready' : 'Blocked by live or unresolved records'} · {formatBytes(item.estimatedBytes)}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="mc-btn mc-btn--primary" disabled={busy || !planCanCommit} onClick={() => void quarantine()}>
              Confirm quarantine
            </button>
          </div>
        ) : null}
        {inventory?.quarantinedRuns.length ? (
          <div className="control-retention__quarantined">
            <strong>Quarantined</strong>
            <ul>
              {inventory.quarantinedRuns.map((run) => (
                <li key={run.runRef}>
                  <span>{run.title} · {formatBytes(run.estimatedBytes)}</span>
                  <button type="button" className="mc-btn" disabled={busy} onClick={() => void restore(run.runRef)}>Restore</button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}
