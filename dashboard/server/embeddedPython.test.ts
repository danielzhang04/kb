import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

// Server modules ship Python as exported string constants (run via python at runtime).
// tsc and vitest never parse that Python, so a stray token stays invisible until a live
// run crashes — exactly how `if (a or b:` in MANAGED_ROOT_ACTIVATION_SCRIPT reached main.
// This imports each constant's RESOLVED runtime string (JS has already applied template
// escapes/interpolation) and asks Python to ast.parse it. No source-scraping, no escape
// false positives.
import {
  CANONICAL_RESULT_CARD_SCRIPT,
  CANONICAL_RESULT_VERIFY_SCRIPT,
} from './control/canonicalResultIntegrator.ts';
import {
  QUEUE_BRIDGE_SELECT_SCRIPT,
  QUEUE_BRIDGE_READ_CARD_SCRIPT,
  QUEUE_BRIDGE_RECONCILE_SCRIPT,
  QUEUE_BRIDGE_LEDGER_COST_SCRIPT,
} from './control/queueBridge.ts';
import { MANAGED_ROOT_ACTIVATION_SCRIPT, WORKFLOW_CARD_OP_SCRIPT } from './write/workflowRun.ts';
import { CARD_RESPOND_SCRIPT } from './write/cardRespond.ts';
import { CARD_ROUTING_SCRIPT } from './write/cardRouting.ts';
import { CARD_OP_SCRIPT } from './write/launch.ts';
import { STOP_CARD_SCRIPT } from './stop/floor.ts';
import {
  SIGNED_VERIFY_SCRIPT,
  POSSESSION_VERIFY_SCRIPT,
  WEBAUTHN_VERIFY_SCRIPT,
} from './approvals/inbox.ts';

const SCRIPTS: Record<string, string> = {
  CANONICAL_RESULT_CARD_SCRIPT,
  CANONICAL_RESULT_VERIFY_SCRIPT,
  QUEUE_BRIDGE_SELECT_SCRIPT,
  QUEUE_BRIDGE_READ_CARD_SCRIPT,
  QUEUE_BRIDGE_RECONCILE_SCRIPT,
  QUEUE_BRIDGE_LEDGER_COST_SCRIPT,
  MANAGED_ROOT_ACTIVATION_SCRIPT,
  WORKFLOW_CARD_OP_SCRIPT,
  CARD_RESPOND_SCRIPT,
  CARD_ROUTING_SCRIPT,
  CARD_OP_SCRIPT,
  STOP_CARD_SCRIPT,
  SIGNED_VERIFY_SCRIPT,
  POSSESSION_VERIFY_SCRIPT,
  WEBAUTHN_VERIFY_SCRIPT,
};

const python = process.platform === 'win32' ? 'py' : 'python3';

function pythonAvailable(): boolean {
  const r = spawnSync(python, ['-c', 'pass'], { encoding: 'utf8' });
  return r.status === 0;
}

describe('embedded Python scripts are syntactically valid', () => {
  const havePython = pythonAvailable();
  // A guard that silently skips is worse than none: in CI it would go green while
  // protecting nothing. Under CI, absence of Python is a hard failure; on a dev box
  // without Python the checks skip rather than block unrelated work.
  it('python is available (required in CI)', () => {
    if (process.env.CI) expect(havePython, 'Python must be on PATH in CI for this guard').toBe(true);
    else expect(true).toBe(true);
  });
  for (const [name, script] of Object.entries(SCRIPTS)) {
    it.runIf(havePython)(`${name} parses`, () => {
      const r = spawnSync(python, ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], {
        input: script,
        encoding: 'utf8',
      });
      expect(r.stderr || '', `${name} failed to parse`).not.toMatch(/SyntaxError/);
      expect(r.status).toBe(0);
    });
  }
});
