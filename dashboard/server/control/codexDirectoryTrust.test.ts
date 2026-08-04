import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureCodexDirectoryTrusted } from './codexDirectoryTrust.ts';

const homes: string[] = [];

function codexHome(): string {
  const value = mkdtempSync(join(tmpdir(), 'codex-trust-'));
  homes.push(value);
  return value;
}

function configPath(home: string): string {
  return join(home, 'config.toml');
}

function expectedKey(workDir: string): string {
  return resolve(workDir).toLowerCase();
}

afterEach(() => {
  for (const value of homes.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('ensureCodexDirectoryTrusted', () => {
  it('creates config.toml with the exact trusted-project table when absent', async () => {
    const home = codexHome();
    const workDir = resolve(tmpdir(), 'Kb-Worktrees', 'Boss-Fyt', 'orgs', 'faceless-youtube');
    await ensureCodexDirectoryTrusted(workDir, { codexHome: home });
    const content = readFileSync(configPath(home), 'utf8');
    expect(content).toBe(`[projects.'${expectedKey(workDir)}']\ntrust_level = "trusted"\n`);
    // The stored key is lowercased exactly as codex writes it.
    expect(content).toContain(`[projects.'${expectedKey(workDir)}']`);
    expect(content).not.toContain('Kb-Worktrees');
  });

  it('is a no-op when the exact entry already exists (file unchanged byte-for-byte)', async () => {
    const home = codexHome();
    const workDir = resolve(tmpdir(), 'wt-existing', 'orgs', 'proj');
    const original = `forced_login_method = "chatgpt"\n\n[projects.'${expectedKey(workDir)}']\ntrust_level = "trusted"\n`;
    writeFileSync(configPath(home), original, 'utf8');
    await ensureCodexDirectoryTrusted(workDir, { codexHome: home });
    expect(readFileSync(configPath(home), 'utf8')).toBe(original);
  });

  it('appends a new table while preserving existing entries byte-for-byte', async () => {
    const home = codexHome();
    const other = resolve(tmpdir(), 'wt-other', 'orgs', 'proj');
    const workDir = resolve(tmpdir(), 'wt-new', 'orgs', 'proj');
    const original = `cli_auth_credentials_store = "keyring"\n\n[projects.'${expectedKey(other)}']\ntrust_level = "trusted"\n`;
    writeFileSync(configPath(home), original, 'utf8');
    await ensureCodexDirectoryTrusted(workDir, { codexHome: home });
    const content = readFileSync(configPath(home), 'utf8');
    // Existing content is preserved as a prefix, untouched.
    expect(content.startsWith(original)).toBe(true);
    // The new table is appended, separated by exactly one blank line.
    expect(content).toBe(`${original}\n[projects.'${expectedKey(workDir)}']\ntrust_level = "trusted"\n`);
    // Both project entries survive.
    expect(content).toContain(`[projects.'${expectedKey(other)}']`);
    expect(content).toContain(`[projects.'${expectedKey(workDir)}']`);
  });

  it('serializes concurrent calls for different paths onto one config without corruption', async () => {
    const home = codexHome();
    const dirs = Array.from({ length: 6 }, (_unused, index) =>
      resolve(tmpdir(), `wt-concurrent-${index}`, 'orgs', 'proj'));
    await Promise.all(dirs.map((dir) => ensureCodexDirectoryTrusted(dir, { codexHome: home })));
    const content = readFileSync(configPath(home), 'utf8');
    for (const dir of dirs) {
      const header = `[projects.'${expectedKey(dir)}']`;
      // Each entry present exactly once — no lost updates, no duplicates.
      const occurrences = content.split(header).length - 1;
      expect(occurrences).toBe(1);
    }
    // Every table has its trust_level line: header count equals trusted-line count.
    const headers = (content.match(/\[projects\.'/g) ?? []).length;
    const trusted = (content.match(/trust_level = "trusted"/g) ?? []).length;
    expect(headers).toBe(dirs.length);
    expect(trusted).toBe(dirs.length);
    // Concurrent calls left no lock artifact behind.
    expect(existsSync(`${configPath(home)}.kb-trust.lock`)).toBe(false);
  });

  it('is idempotent across repeated calls for the same path', async () => {
    const home = codexHome();
    const workDir = resolve(tmpdir(), 'wt-idempotent', 'orgs', 'proj');
    await ensureCodexDirectoryTrusted(workDir, { codexHome: home });
    const first = readFileSync(configPath(home), 'utf8');
    await ensureCodexDirectoryTrusted(workDir, { codexHome: home });
    await ensureCodexDirectoryTrusted(workDir, { codexHome: home });
    expect(readFileSync(configPath(home), 'utf8')).toBe(first);
  });

  it('rejects a non-absolute work directory', async () => {
    const home = codexHome();
    await expect(ensureCodexDirectoryTrusted('relative/path', { codexHome: home })).rejects.toThrow();
  });
});
