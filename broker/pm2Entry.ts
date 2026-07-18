/**
 * PM2 entry for the Broker daemon.
 *
 * Same rationale as dashboard/server/pm2Entry.ts: PM2's fork container require()s the script,
 * so daemon.ts's executed-directly guard never fires under `pm2 start pm2.config.cjs` and the
 * Broker would sit "online" without listening. This module runs the identical boot sequence
 * unconditionally; direct runs keep using `node broker/daemon.ts`.
 *
 * repoRoot comes from process.cwd() exactly like the direct-run path — pm2.config.cjs now pins
 * `cwd` to the repo root so the preamble/STOP/token paths resolve identically under PM2.
 */
import { bootBroker } from './daemon.ts';

bootBroker({
  repoRoot: process.cwd(),
  onError: (err) => process.stderr.write(`[kb-broker] connection error: ${(err as Error)?.message ?? err}\n`),
})
  .then((result) => {
    if (!result.ok) {
      process.stderr.write(`[kb-broker] refusing to boot (fleet not runnable): ${result.problems.join('; ')}\n`);
      process.exit(1);
    }
    process.stderr.write('[kb-broker] control transport listening\n');
  })
  .catch((err) => {
    process.stderr.write(`[kb-broker] boot failed (fail-closed): ${(err as Error)?.message ?? err}\n`);
    process.exit(1);
  });
