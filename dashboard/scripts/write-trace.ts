#!/usr/bin/env node
/**
 * D0.8 CLI — render a dispatch's transcript to a distilled static trace permalink and write it under
 * `traces/<card-id>/index.html`.
 *
 *   node scripts/write-trace.ts --session <path.jsonl> --card <card-id> [--repo <root>] [--commit]
 *
 * Thin wrapper: all logic lives in the unit-tested `server/trace/` modules (render + commit). By
 * default it RENDERS TO A LOCAL PATH ONLY (D0's read-only posture). Passing `--commit` performs the
 * runtime `ops`-branch pull-rebase-push coordination write via the default git runner — reserved for
 * the governed-write era; omit it in D0.
 */

import { renderTrace } from '../server/trace/render';
import { writeTrace } from '../server/trace/commit';

interface Args {
  session?: string;
  card?: string;
  repo: string;
  commit: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { repo: process.cwd(), commit: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--session') args.session = argv[++i];
    else if (a === '--card') args.card = argv[++i];
    else if (a === '--repo') args.repo = argv[++i];
    else if (a === '--commit') args.commit = true;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.session || !args.card) {
    process.stderr.write('usage: write-trace --session <path.jsonl> --card <card-id> [--repo <root>] [--commit]\n');
    process.exit(2);
    return;
  }
  const html = await renderTrace(args.session, args.card);
  const file = writeTrace({ repoRoot: args.repo, cardId: args.card, html, commit: args.commit });
  process.stdout.write(`${file}\n`);
}

main().catch((err) => {
  process.stderr.write(`write-trace failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
