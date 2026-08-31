/**
 * D2.4 — card verifier: child-process-driven approval verification for the Inbox card channel.
 *
 * `driveVerify` shells the verifier matching a card's approval channel. Two of the three channels
 * (`signed`, `possession`) are the fleet's `scripts/approvals.py` — which has **no argparse CLI**
 * (confirmed by reading the file: no `__main__`, no `add_argument`), so per the plan this is invoked
 * via the documented MODULE interface: `python -c "import sys; sys.path.insert(0,'scripts'); import
 * approvals; ..."`, never a nonexistent `approvals.py verify_signed_approval` CLI subcommand — adding
 * a CLI to `approvals.py` would be a second fleet-file edit, out of this task's scope
 * (`scripts/**` is shelled, never modified). The third (`webauthn`) shells `scripts/webauthn_verify.py`
 * — the D2.3 dispatcher-side verifier — the SAME module-interface way (see the WEBAUTHN_VERIFY_SCRIPT
 * doc below for why, even though that module does carry its own small CLI).
 *
 * Every script prints exactly one JSON line (`{"ok", "reason", "card"?}`) and NEVER writes `queue/` —
 * the verifier's returned, pinned `.card` (parsed from the committed object the fleet/D2.3 verifier
 * already re-checked the working tree against) is the sole authority `driveVerify`'s caller acts on.
 * The actual subprocess call is the SAME injectable `PyRunner` shape `write/launch.ts` already
 * established (`(repoRoot, code, jsonArg) => PyRunResult`) — reused here rather than reinvented, so
 * tests stay hermetic (no real `py` binary, no real `queue/` tree) and the DI seam is consistent
 * dashboard-wide.
 */
import { defaultPyRunner } from '../write/launch.ts';
import type { PyRunner, PyRunResult } from '../write/launch.ts';

export type ApprovalChannel = 'signed' | 'possession' | 'webauthn';

/**
 * The pinned, verified view of a card a verifier returned — the executor acts on THESE fields, never a
 * re-read of the mutable working tree (mirrors `approvals.VerifyResult`/`webauthn_verify.WebAuthnResult`
 * carrying `.card` for exactly this reason).
 */
export interface VerifiedCardView {
  id: string;
  action: string;
  target: string;
  riskTier: string;
  owner: string | null;
  body: string;
}

export interface VerifyOutcome {
  ok: boolean;
  reason: string;
  card?: VerifiedCardView;
}

/** The fixed Python snippet shared by all three channels: parse `[cardPath, repoRoot]` from
 *  `sys.argv[1]`, call `fn`, print one JSON line. `fn` is inlined per-channel below (never
 *  string-concatenated from untrusted input — the only variable input travels as the separate argv
 *  JSON element, exactly like `write/launch.ts#CARD_OP_SCRIPT`). */
function verifyScript(importLine: string, callExpr: string): string {
  return `
import sys, json
sys.path.insert(0, "scripts")
${importLine}

card_path, repo_root = json.loads(sys.argv[1])
result = ${callExpr}
out = {"ok": result.ok, "reason": result.reason}
if result.ok and result.card is not None:
    out["card"] = {
        "id": result.card.meta.get("id"),
        "action": result.card.meta.get("action"),
        "target": result.card.meta.get("target"),
        "riskTier": result.card.meta.get("risk-tier"),
        "owner": result.card.meta.get("owner"),
        "body": result.card.body,
    }
print(json.dumps(out))
`.trim();
}

/** FLEET SIGNED CHANNEL — module interface into `scripts/approvals.verify_signed_approval`. */
export const SIGNED_VERIFY_SCRIPT = verifyScript(
  'import approvals',
  'approvals.verify_signed_approval(card_path, repo_root)',
);

/** FLEET POSSESSION CHANNEL — module interface into `scripts/approvals.verify_telegram_approval`. */
export const POSSESSION_VERIFY_SCRIPT = verifyScript(
  'import approvals',
  'approvals.verify_telegram_approval(card_path, repo_root)',
);

/**
 * WEBAUTHN CHANNEL (D2.3 T3 boundary) — `scripts/webauthn_verify.py` DOES carry its own small CLI
 * (`_main`, deliberately: "CLI — dashboard-owned, so a small entry point is fine (unlike
 * approvals.py)"), but that CLI only ever prints `{"ok", "reason"}` — no pinned card content — and the
 * pinned-content execute below needs the verified `.card` view. So this channel ALSO goes through the
 * module interface (imports `webauthn_verify` directly and reads `.card` off the result) rather than
 * the CLI, for the identical reason the fleet channels do: the caller must act on the verifier's
 * PINNED bytes, never a re-read of the working tree.
 */
export const WEBAUTHN_VERIFY_SCRIPT = verifyScript(
  'import webauthn_verify',
  'webauthn_verify.verify_webauthn_approval(card_path, repo_root)',
);

const SCRIPT_FOR: Record<ApprovalChannel, string> = {
  signed: SIGNED_VERIFY_SCRIPT,
  possession: POSSESSION_VERIFY_SCRIPT,
  webauthn: WEBAUTHN_VERIFY_SCRIPT,
};

/** Parse the one-line JSON a verify script prints. Malformed/absent stdout fails closed. */
function parseVerifyStdout(stdout: string): VerifyOutcome {
  const lastLine = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
  try {
    const parsed = JSON.parse(lastLine) as { ok?: unknown; reason?: unknown; card?: VerifiedCardView };
    return {
      ok: parsed.ok === true,
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'verifier gave no reason',
      card: parsed.card,
    };
  } catch {
    return { ok: false, reason: 'verifier produced no parseable output (fail closed)' };
  }
}

export interface DriveVerifyDeps {
  repoRoot: string;
  runPy?: PyRunner;
  /**
   * WEBAUTHN-ONLY: the pinned-content execute the D2.3 boundary triggers once the assertion verifies.
   * Runs against the VERIFIED, pinned card view the subprocess returned — never a re-read of the
   * working tree. Never invoked for the fleet channels (those only record a human-minted approval;
   * acting on it is the fleet dispatcher's job, out of this task's file scope) and never invoked on a
   * failed verify.
   */
  execute?: (card: VerifiedCardView) => void;
}

/**
 * Drive the verifier matching `channel` against `cardPath`, via the injected `PyRunner` (default:
 * shell `py -3 -c <script> <jsonArg>`, same as `write/launch.ts`). NEVER writes `queue/` directly —
 * every script above only ever reads/verifies; the returned `.card` (parsed from the committed, pinned
 * object) is the sole authority the caller acts on. For the `webauthn` channel, a successful verify
 * triggers `deps.execute` with the pinned card view — wiring the T3 boundary end-to-end (D2.3's verify
 * -> D2.4's pinned-content execute), not merely unit-testing the verifier in isolation.
 */
export function driveVerify(cardPath: string, channel: ApprovalChannel, deps: DriveVerifyDeps): VerifyOutcome {
  const runPy = deps.runPy ?? defaultPyRunner;
  const script = SCRIPT_FOR[channel];
  const jsonArg = JSON.stringify([cardPath, deps.repoRoot]);

  const result: PyRunResult = runPy(deps.repoRoot, script, jsonArg);
  if (result.exitCode !== 0) {
    return { ok: false, reason: result.stderr.trim() || result.stdout.trim() || 'verifier exited non-zero' };
  }

  const outcome = parseVerifyStdout(result.stdout);
  if (outcome.ok && channel === 'webauthn' && outcome.card && deps.execute) {
    deps.execute(outcome.card);
  }
  return outcome;
}
