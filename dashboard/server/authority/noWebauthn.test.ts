import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

// Three files are deliberately exempt from this scan, all for the same reason: the literal 2026-07-31
// incident-recovery prompt text contains the word "passkey" as a fact about what a REAL prior recovery
// already said, not a live auth mechanism — see authorizedIncidentRecovery.ts's own FROZEN doc comment
// on `AUTHORIZED_20260731_EXECUTION_LOCK_NEW_PROMPT`. Editing that string for wording would change the
// fingerprint every already-recovered historical document was validated against, so a real prior
// recovery would stop validating.
//   - control/authorizedIncidentRecovery.ts is the source of truth for the frozen string (and this
//     guard's own doc comment above, mirrored here, necessarily repeats the words being searched for).
//   - src/control/controlClient.ts is browser-bundled frontend code; it cannot import the server-side
//     constant (that module pulls in Node-only deps), so it duplicates the literal with its own FROZEN
//     comment instead.
// Every OTHER consumer (control/launch.ts, control/routes.test.ts) imports the constant by name instead
// of duplicating the literal, so they need no exemption and stay covered by this scan.
const EXEMPT = [
  ':(exclude)dashboard/server/authority/noWebauthn.test.ts',
  ':(exclude)dashboard/server/control/authorizedIncidentRecovery.ts',
  ':(exclude)dashboard/src/control/controlClient.ts',
];

describe('webauthn is gone', () => {
  it('appears in no dashboard, deploy or scripts source file', () => {
    let out = '';
    try {
      // `dashboard/pm2.config.cjs` is named explicitly (security review 2026-09-16, MEDIUM-6): it sits
      // ABOVE every prefix this scan used to list, so the committed launcher for the always-on local
      // daemon went on setting `DASHBOARD_WEBAUTHN_CREDENTIALS` -- live config for a deleted mechanism,
      // whose reader `auth/credentialStore.ts` no longer exists -- while this guard stayed green.
      // Widening to the whole `dashboard` prefix instead would pull in ALWAYS-ON.md and docs/, which are
      // prose about a past design and are a separate cleanup.
      out = execFileSync('git', ['grep', '-ril', '-e', 'webauthn', '-e', 'passkey', '--',
        'dashboard/server', 'dashboard/src', 'dashboard/pm2.config.cjs', 'deploy', 'scripts',
        ...EXEMPT], { cwd: ROOT, encoding: 'utf8' });
    } catch (err: unknown) {
      // git grep exits 1 with no output when there are no matches — that is the pass.
      out = (err as { stdout?: string }).stdout ?? '';
    }
    expect(out.trim().split('\n').filter(Boolean)).toEqual([]);
  });
});
