/**
 * U10 — read-only projection of transcript-mined lesson proposals. The miner
 * writes reviewable markdown under docs/proposals/lessons; this route only
 * lists and parses it. It has no route capable of accepting a proposal into
 * memory/, and does not touch dashboard/server/index.ts (wired separately).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { resolveRepoRoot } from '../planeA/routes.ts';

interface LessonProposalEntry {
  lesson: string;
  confidence: 'high' | 'med' | 'low';
  evidence: string;
  sourceSession: string;
}

interface LessonProposalFile {
  file: string;
  status: 'PROPOSED';
  sourceSession: string;
  entries: LessonProposalEntry[];
}

interface LessonProposalResponse {
  files: LessonProposalFile[];
  entries: Array<LessonProposalEntry & { file: string }>;
}

function proposalRoot(repoRoot: string): string {
  return join(repoRoot, 'docs', 'proposals', 'lessons');
}

function header(text: string, key: string): string | null {
  return new RegExp(`^${key}:\\s*(.+)\\s*$`, 'm').exec(text)?.[1]?.trim() ?? null;
}

/** Parse only the deliberately small markdown contract emitted by session_miner.py. */
function parseProposalFile(file: string, text: string): LessonProposalFile | null {
  if (header(text, 'status') !== 'PROPOSED') return null;
  const sourceSession = header(text, 'source_session');
  if (sourceSession === null) return null;
  const entries: LessonProposalEntry[] = [];
  for (const block of text.split(/^## ADD\s+\d+\s*$/m).slice(1)) {
    const lesson = header(block, '- lesson');
    const confidence = header(block, '- confidence');
    const evidence = header(block, '- evidence');
    const entrySession = header(block, '- source_session') ?? sourceSession;
    if (lesson === null || evidence === null || (confidence !== 'high' && confidence !== 'med' && confidence !== 'low')) continue;
    entries.push({ lesson, confidence, evidence, sourceSession: entrySession });
  }
  return { file, status: 'PROPOSED', sourceSession, entries };
}

function listLessonProposals(repoRoot: string = resolveRepoRoot()): LessonProposalResponse {
  const root = proposalRoot(repoRoot);
  if (!existsSync(root)) return { files: [], entries: [] };
  const files = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .flatMap((file) => {
      const parsed = parseProposalFile(file, readFileSync(join(root, file), 'utf8'));
      return parsed === null ? [] : [parsed];
    });
  return {
    files,
    entries: files.flatMap((proposal) => proposal.entries.map((entry) => ({ ...entry, file: proposal.file }))),
  };
}

/** Register a GET-only, review-only route; it cannot accept or apply a lesson. */
export function registerLessons(app: FastifyInstance, repoRoot: string = resolveRepoRoot()): void {
  app.get('/api/lessons/proposals', async () => listLessonProposals(repoRoot));
}
