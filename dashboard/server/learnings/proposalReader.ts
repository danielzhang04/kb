// P4-C39: the Learnings Implementer's record reader. It reuses the ONE Markdown parser
// (`scripts/learning_proposals.py`) through the bounded-process JSON path and decodes the result
// with the W0 contracts; there is no second Markdown parser and no use of `planeA/indexer.ts`,
// whose `indexRepo` returns `{cards, ledgers, orgStates}` and has no `docs/` slice.
//
// The module is READ-ONLY: it never writes, never touches git, and holds no process capability
// beyond the single parser invocation below. Refusals (a symlinked record, a path resolving
// outside `<coordinationRoot>/docs/proposals/learnings`, a malformed record) fail the whole read.
// A missing directory is an empty result, not an error.
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYTHON_STDOUT_MAX_BYTES, pythonFailureResult, runPythonSync } from '../runtime/python.ts';
import { decodeProposalRecords, type ProposalRecord } from './contracts.ts';

/** The sole Markdown parser/renderer, executed for closed JSON output. */
export const LEARNING_PROPOSAL_PARSER = 'learning_proposals.py';
export const PROPOSAL_READ_TIMEOUT_MS = 20_000;

/**
 * The parser is resolved from THIS module's own location, never from `DASHBOARD_PLATFORM_ROOT`.
 * The reader executes an interpreter, so an environment variable must not be able to choose which
 * `scripts/learning_proposals.py` runs: on a release tree the module and its `scripts/` ship
 * together, and pinning to the module means an attacker-set env var cannot redirect execution.
 */
export const PROPOSAL_PARSER_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * A minimal environment for the parser subprocess. It reads one directory and writes nothing, so
 * it needs only enough to locate the interpreter; nothing else in the server's environment
 * (tokens, repo roots, `PYTHON*` tuning) is exported into it.
 */
const PARSER_ENV_ALLOWLIST = [
  'PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR',
] as const;

function parserEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { PYTHONIOENCODING: 'utf-8' };
  for (const key of PARSER_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export interface ProposalReadOptions {
  readonly timeoutMs?: number;
  /** Test-only stdout ceiling, to prove the read fails closed rather than truncating. */
  readonly maxBuffer?: number;
}

export class ProposalReadError extends Error {
  readonly detail: string;

  constructor(message: string, detail = '') {
    super(detail ? `${message}: ${detail}` : message);
    this.name = 'ProposalReadError';
    this.detail = detail;
  }
}

/**
 * Every `status: proposed` learning-proposal record under
 * `<coordinationRoot>/docs/proposals/learnings`, sorted by `id`. `coordinationRoot` is the
 * composition-time `HttpSurfaceContext.repoRoot` — the read-only coordination checkout.
 */
export function readProposedLearningRecords(
  coordinationRoot: string, options: ProposalReadOptions = {},
): readonly ProposalRecord[] {
  if (typeof coordinationRoot !== 'string' || coordinationRoot.length === 0 || !isAbsolute(coordinationRoot)) {
    throw new ProposalReadError('one absolute coordination root is required');
  }
  let stdout: string;
  try {
    stdout = runPythonSync(
      [join(PROPOSAL_PARSER_ROOT, 'scripts', LEARNING_PROPOSAL_PARSER), 'read', '--root', coordinationRoot],
      {
        cwd: PROPOSAL_PARSER_ROOT,
        platformRoot: PROPOSAL_PARSER_ROOT,
        timeoutMs: options.timeoutMs ?? PROPOSAL_READ_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? PYTHON_STDOUT_MAX_BYTES,
        environment: parserEnvironment(),
      },
    );
  } catch (error) {
    throw new ProposalReadError(
      'the learning-proposal read failed closed', pythonFailureResult(error).stderr.slice(0, 500).trim(),
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new ProposalReadError('the learning-proposal parser did not emit JSON');
  }
  return decodeProposalRecords(payload)
    .filter((record) => record.status === 'proposed')
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}
