/**
 * R2 — the shared per-entity routing control: a mono effective-model chip with a provenance tag, that
 * opens a small popover to pick runtime + model (+ optional TTL) and writes through a GOVERNED endpoint.
 * Endpoint-agnostic: the parent supplies `onApply` / `onClear` (Agents -> routing-override agent scope;
 * Tasks -> card-routing card scope), so this component never calls fetch directly and never chooses a
 * write path. Fail-closed like launchControls: without a session the control is disabled with a nudge;
 * `canAct` is `session || onRequestSession` (the parent resolves the token at point-of-action).
 *
 * Styling: Claude-dark neutral — mono model ids, provenance as a muted mono tag, semantic status dots
 * only (no decorative accent). No new colors.
 */
import { useState } from 'react';
import type {
  EffectiveOrUnroutable,
  RuntimeRegistryEntry,
  WriteResult,
} from '../lib/routingClient';
import '../styles/views/routing.css';

/** Human tag for a provenance source. */
export function sourceLabel(source: string): string {
  switch (source) {
    case 'card':
      return 'card';
    case 'override':
      return 'override';
    case 'policy':
      return 'policy';
    case 'default':
      return 'default';
    default:
      return source;
  }
}

const TTL_OPTIONS: Array<{ label: string; ms: number | null }> = [
  { label: 'no expiry', ms: null },
  { label: '1h', ms: 60 * 60 * 1000 },
  { label: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
];

export interface RoutingControlProps {
  /** aria/label context, e.g. an agent id or card id. */
  label: string;
  registry: Record<string, RuntimeRegistryEntry>;
  /** Effective routing to display in the chip (or an unroutable marker). */
  effective?: EffectiveOrUnroutable | null;
  /** Whether a session (or point-of-action mint) is available — governs enablement. */
  canAct: boolean;
  /** Show the TTL selector (agent-scope overrides expire; card-frontmatter overrides do not). */
  ttl?: boolean;
  /** Whether a "clear override" affordance should show (an override/stamp currently exists). */
  canClear?: boolean;
  /** When set, the control is frozen: the chip is disabled and this quiet reason is shown inline. Used
   *  by the Tasks card-scope toggle when the card is under an active approval (approvals/approved) — the
   *  server refuses the write too, so this is an upfront, legible mirror of that refusal (no new colors). */
  lockedReason?: string | null;
  onApply: (runtime: string, model: string, expires: string | null) => Promise<WriteResult>;
  onClear?: () => Promise<WriteResult>;
  testIdPrefix: string;
}

/** The always-visible effective chip: mono model id + a muted provenance tag (or an unroutable marker). */
function EffectiveChip({ effective }: { effective?: EffectiveOrUnroutable | null }): React.JSX.Element {
  if (!effective) {
    return <span className="v-routing__model mc-mono v-routing__model--none">—</span>;
  }
  if ('unroutable' in effective && effective.unroutable) {
    return (
      <span className="v-routing__unroutable" title={effective.reason}>
        <span className="mc-status-dot mc-status-dot--error" aria-hidden="true" />
        <span className="mc-mono">unroutable</span>
      </span>
    );
  }
  const src = effective.sourceModel;
  return (
    <>
      <span className="v-routing__model mc-mono">{effective.model}</span>
      <span className={`v-routing__src mc-mono v-routing__src--${src}`} title={`runtime ${effective.runtime} · source ${src}`}>
        {sourceLabel(src)}
      </span>
    </>
  );
}

export function RoutingControl(props: RoutingControlProps): React.JSX.Element {
  const { label, registry, effective, canAct, ttl = false, canClear = false, lockedReason = null, onApply, onClear, testIdPrefix } = props;
  const runtimeNames = Object.keys(registry);
  const effectiveRuntime = effective && !('unroutable' in effective && effective.unroutable) ? effective.runtime : undefined;
  const initialRuntime = effectiveRuntime && runtimeNames.includes(effectiveRuntime) ? effectiveRuntime : runtimeNames[0] ?? '';

  const [open, setOpen] = useState(false);
  const [runtime, setRuntime] = useState(initialRuntime);
  const [model, setModel] = useState<string>(() => registry[initialRuntime]?.known_models[0] ?? '');
  const [ttlMs, setTtlMs] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const models = registry[runtime]?.known_models ?? [];

  function pickRuntime(next: string): void {
    setRuntime(next);
    // Keep the model valid for the newly-selected runtime.
    const km = registry[next]?.known_models ?? [];
    if (!km.includes(model)) setModel(km[0] ?? '');
  }

  async function apply(): Promise<void> {
    if (!canAct || !runtime || !model) return;
    setBusy(true);
    const expires = ttlMs === null ? null : new Date(Date.now() + ttlMs).toISOString();
    const res = await onApply(runtime, model, ttl ? expires : null);
    setBusy(false);
    setStatus(res.ok ? 'saved' : `refused: ${res.reason ?? 'error'}`);
    if (res.ok) setOpen(false);
  }

  async function clear(): Promise<void> {
    if (!canAct || !onClear) return;
    setBusy(true);
    const res = await onClear();
    setBusy(false);
    setStatus(res.ok ? 'cleared' : `refused: ${res.reason ?? 'error'}`);
    if (res.ok) setOpen(false);
  }

  const noRegistry = runtimeNames.length === 0;
  const locked = Boolean(lockedReason);

  return (
    <span className="v-routing" data-testid={`${testIdPrefix}-routing`}>
      <button
        type="button"
        className="v-routing__chip"
        data-testid={`${testIdPrefix}-routing-chip`}
        aria-label={`Routing for ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!canAct || noRegistry || locked}
        title={locked ? (lockedReason as string) : canAct ? 'Change routing' : 'Sign in with your passkey to change routing'}
        onClick={() => setOpen((o) => !o)}
      >
        <EffectiveChip effective={effective} />
      </button>

      {!canAct ? (
        <span className="v-routing__nudge" data-testid={`${testIdPrefix}-routing-nudge`}>
          sign in to change
        </span>
      ) : locked ? (
        <span className="v-routing__nudge" data-testid={`${testIdPrefix}-routing-locked`}>
          {lockedReason}
        </span>
      ) : null}

      {open && canAct && !locked ? (
        <div className="v-routing__pop mc-panel" role="dialog" aria-label={`Set routing for ${label}`} data-testid={`${testIdPrefix}-routing-pop`}>
          <label className="v-routing__field">
            <span className="v-routing__field-label">runtime</span>
            <select className="mc-mono" aria-label="Runtime" value={runtime} onChange={(e) => pickRuntime(e.target.value)}>
              {runtimeNames.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="v-routing__field">
            <span className="v-routing__field-label">model</span>
            <select className="mc-mono" aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          {ttl ? (
            <label className="v-routing__field">
              <span className="v-routing__field-label">expires</span>
              <select
                className="mc-mono"
                aria-label="Expiry"
                value={String(ttlMs)}
                onChange={(e) => setTtlMs(e.target.value === 'null' ? null : Number(e.target.value))}
              >
                {TTL_OPTIONS.map((o) => (
                  <option key={o.label} value={String(o.ms)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="v-routing__actions">
            <button type="button" className="mc-btn mc-btn--primary" disabled={busy} onClick={() => void apply()}>
              Apply
            </button>
            {canClear && onClear ? (
              <button type="button" className="mc-btn mc-btn--quiet" disabled={busy} onClick={() => void clear()} data-testid={`${testIdPrefix}-routing-clear`}>
                Clear override
              </button>
            ) : null}
            <button type="button" className="mc-btn mc-btn--quiet" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          {status ? (
            <p className="v-routing__status mc-mono" data-testid={`${testIdPrefix}-routing-status`}>
              {status}
            </p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
