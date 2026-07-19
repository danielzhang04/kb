#!/usr/bin/env node
/**
 * source: ecc@2.0.0/scripts/ci/check-unicode-safety.js
 * imported: 2026-07-19
 * provenance-tier: imported
 *
 * kb retarget: the dangerous-invisible-codepoint table, allowed-symbol set,
 * and emoji regex are copied VERBATIM from ECC (that is the value). Only the
 * CLI plumbing is retargeted to the kb contract:
 *   node scripts/ci/check_unicode_safety.js [path...]
 *   - exit 0 when clean, exit 1 with findings one-per-line on stdout.
 *   - path args may be files or directories (directories are walked).
 *   - with no args, walks the repo root.
 * ECC's --write auto-sanitizer is dropped; kb's gate is detection-only.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

const ignoredDirs = new Set([
  '.git',
  'node_modules',
  '.dmux',
  '.next',
  '.venv',
  'coverage',
  'venv',
]);

const textExtensions = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.js',
  '.cjs',
  '.mjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.json',
  '.toml',
  '.yml',
  '.yaml',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.py',
  '.rs',
]);

// --- VERBATIM from ECC: emoji + invisible-codepoint pattern tables ---------

const emojiRe = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})/gu;
const allowedSymbolCodePoints = new Set([
  0x00A9,
  0x00AE,
  0x2122,
]);

function isTextFile(filePath) {
  return textExtensions.has(path.extname(filePath).toLowerCase());
}

function shouldSkip(entryPath) {
  return entryPath.split(path.sep).some(part => ignoredDirs.has(part));
}

function listFiles(dirPath) {
  const results = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (shouldSkip(entryPath)) continue;
    if (entry.isDirectory()) {
      results.push(...listFiles(entryPath));
      continue;
    }
    if (entry.isFile() && isTextFile(entryPath)) {
      results.push(entryPath);
    }
  }
  return results;
}

function lineAndColumn(text, index) {
  const line = text.slice(0, index).split('\n').length;
  const lastNewline = text.lastIndexOf('\n', index - 1);
  const column = index - lastNewline;
  return { line, column };
}

function isAllowedEmojiLikeSymbol(char) {
  return allowedSymbolCodePoints.has(char.codePointAt(0));
}

function isDangerousInvisibleCodePoint(codePoint) {
  return (
    (codePoint >= 0x200B && codePoint <= 0x200D) ||
    codePoint === 0x2060 ||
    codePoint === 0xFEFF ||
    (codePoint >= 0x202A && codePoint <= 0x202E) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    (codePoint >= 0xFE00 && codePoint <= 0xFE0F) ||
    (codePoint >= 0xE0100 && codePoint <= 0xE01EF) ||
    // Unicode Tag block (U+E0000–U+E007F). Tag characters were proposed
    // for language tagging in Unicode 3.1 and have been deprecated since
    // Unicode 5.1, so no legitimate text uses them. They are the canonical
    // vector for "ASCII smuggling" / "Tag smuggling" prompt injection:
    // an attacker hides instructions inside ASCII-looking strings (PR
    // bodies, SKILL.md, frontmatter), the LLM consumes the tag bytes,
    // and the human reviewer sees nothing.
    (codePoint >= 0xE0000 && codePoint <= 0xE007F) ||
    // U+180E MONGOLIAN VOWEL SEPARATOR — formerly classified as a space
    // separator, reclassified as a format control in Unicode 6.3; renders
    // as zero-width and routinely abused for homograph / smuggling.
    codePoint === 0x180E ||
    // U+115F / U+1160 HANGUL CHOSEONG/JUNGSEONG FILLER — zero-width fillers
    // used in Korean text shaping; abused as invisible characters.
    codePoint === 0x115F ||
    codePoint === 0x1160 ||
    // U+2061–U+2064 invisible math operators (FUNCTION APPLICATION,
    // INVISIBLE TIMES, INVISIBLE SEPARATOR, INVISIBLE PLUS). Zero-width
    // and not used outside math typesetting; legitimate Markdown / source
    // does not contain them.
    (codePoint >= 0x2061 && codePoint <= 0x2064) ||
    // U+3164 HANGUL FILLER — zero-width filler reportedly used in Discord
    // / Twitter smuggling attacks; not used in legitimate Korean text.
    codePoint === 0x3164
  );
}

function collectMatches(text, regex, kind) {
  const matches = [];
  for (const match of text.matchAll(regex)) {
    const char = match[0];
    if (kind === 'emoji' && isAllowedEmojiLikeSymbol(char)) {
      continue;
    }
    const index = match.index ?? 0;
    const { line, column } = lineAndColumn(text, index);
    matches.push({
      kind,
      char,
      codePoint: `U+${char.codePointAt(0).toString(16).toUpperCase()}`,
      line,
      column,
    });
  }
  return matches;
}

function collectDangerousInvisibleMatches(text) {
  const matches = [];
  let index = 0;

  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (isDangerousInvisibleCodePoint(codePoint)) {
      const { line, column } = lineAndColumn(text, index);
      matches.push({
        kind: 'dangerous-invisible',
        char,
        codePoint: `U+${codePoint.toString(16).toUpperCase()}`,
        line,
        column,
      });
    }
    index += char.length;
  }

  return matches;
}

// --- kb CLI plumbing -------------------------------------------------------

function collectTargets(args) {
  if (args.length === 0) return listFiles(repoRoot);
  const targets = [];
  for (const arg of args) {
    const resolved = path.resolve(arg);
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      targets.push(...listFiles(resolved));
    } else if (stat.isFile()) {
      // Explicit file arg: scan it regardless of extension.
      targets.push(resolved);
    }
  }
  return targets;
}

function main() {
  const args = process.argv.slice(2).filter(a => a !== '--');
  const targets = collectTargets(args);
  const violations = [];

  for (const filePath of targets) {
    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const fileViolations = [
      ...collectDangerousInvisibleMatches(text),
      ...collectMatches(text, emojiRe, 'emoji'),
    ];
    for (const violation of fileViolations) {
      violations.push({ file: filePath, ...violation });
    }
  }

  if (violations.length > 0) {
    for (const v of violations) {
      console.log(`${v.file}:${v.line}:${v.column} ${v.kind} ${v.codePoint}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main();
