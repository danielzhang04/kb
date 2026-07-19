'use strict';
/**
 * kb command classifier — destructive + credential-store detection.
 *
 * source: ecc@2.0.0/scripts/hooks/gateguard-fact-force.js
 * source: ecc@2.0.0/scripts/lib/shell-substitution.js  (three extractors, inlined)
 * imported: 2026-07-19
 * provenance-tier: imported
 *
 * The destructive-command machinery in the first section (`--- ECC destructive
 * classifier (verbatim) ---`) is copied UNCHANGED from the ECC source: the
 * quote-aware tokenizer, subshell/brace/command-substitution extractors, the
 * `find -exec` walker, the force-push refspec detector, the `rm -rf` flag
 * parser, the git subcommand locator, and the SQL/dd destructive regex. The
 * classifier's judgment IS the import and is NOT re-derived here — where its
 * behavior differs from intuition (e.g. it flags ALL `git push --force`, not
 * only pushes to protected refs), the ECC judgment is preserved deliberately.
 *
 * DROPPED from the ECC source (fact-forcing UX / plumbing that has no place in
 * a stateless kb classifier): the session state files (`STATE_DIR`, load/save/
 * prune/markChecked), the fact-force denial dampening, all gate-message text,
 * the operator-config regex (`GATEGUARD_BASH_EXTRA_DESTRUCTIVE`) and exempt
 * globs, the read-only git-introspection allowlist, the ECC-disable env
 * switches, session-key resolution, and the `run()` PreToolUse dispatcher.
 *
 * ADDED for kb (NOT from ECC — the ECC source has no credential detection):
 * the `--- kb credential-store classifier (Category A) ---` section, which
 * enforces the constitution's absolute hard ceiling (never handle credential
 * stores as objects). It is built on the SAME quote-aware / subshell-aware
 * machinery extracted above so it cannot be bypassed by quoting or `$(...)`.
 *
 * Exports:
 *   isDestructiveBash(command)   -> boolean  (Category B: generally destructive)
 *   isCredentialAccess(command)  -> boolean  (Category A: hard-ceiling)
 */

// ============================================================================
// --- Shell-substitution extractors (ecc@2.0.0/scripts/lib/shell-substitution.js, verbatim) ---
// ============================================================================

function extractCommandSubstitutions(input) {
  const source = String(input || '');
  const substitutions = [];
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];

    if (ch === '\\' && !inSingle) {
      i += 1;
      continue;
    }

    if (ch === "'" && !inDouble && prev !== '\\') {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle && prev !== '\\') {
      inDouble = !inDouble;
      continue;
    }

    if (inSingle) {
      continue;
    }

    if (ch === '`') {
      let body = '';
      i += 1;
      while (i < source.length) {
        const inner = source[i];
        if (inner === '\\') {
          body += inner;
          if (i + 1 < source.length) {
            body += source[i + 1];
            i += 2;
            continue;
          }
        }
        if (inner === '`') {
          break;
        }
        body += inner;
        i += 1;
      }
      if (body.trim()) {
        substitutions.push(body);
        substitutions.push(...extractCommandSubstitutions(body));
      }
      continue;
    }

    if (ch === '$' && source[i + 1] === '(') {
      let depth = 1;
      let body = '';
      let bodyInSingle = false;
      let bodyInDouble = false;
      i += 2;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        const innerPrev = source[i - 1];
        if (inner === '\\' && !bodyInSingle) {
          body += inner;
          if (i + 1 < source.length) {
            body += source[i + 1];
            i += 2;
            continue;
          }
        }
        if (inner === "'" && !bodyInDouble && innerPrev !== '\\') {
          bodyInSingle = !bodyInSingle;
        } else if (inner === '"' && !bodyInSingle && innerPrev !== '\\') {
          bodyInDouble = !bodyInDouble;
        } else if (!bodyInSingle && !bodyInDouble) {
          if (inner === '(') {
            depth += 1;
          } else if (inner === ')') {
            depth -= 1;
            if (depth === 0) {
              break;
            }
          }
        }
        body += inner;
        i += 1;
      }
      if (body.trim()) {
        substitutions.push(body);
        substitutions.push(...extractCommandSubstitutions(body));
      }
    }
  }

  return substitutions;
}

function extractSubshellGroups(input) {
  const source = String(input || '');
  const groups = [];
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];

    if (ch === '\\' && !inSingle) {
      i += 1;
      continue;
    }

    if (ch === "'" && !inDouble && prev !== '\\') {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle && prev !== '\\') {
      inDouble = !inDouble;
      continue;
    }

    if (inSingle || inDouble) {
      continue;
    }

    if (ch === '$' && source[i + 1] === '(') {
      let depth = 1;
      let skipInSingle = false;
      let skipInDouble = false;
      i += 2;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        const innerPrev = source[i - 1];
        if (inner === '\\' && !skipInSingle) {
          i += 2;
          continue;
        }
        if (inner === "'" && !skipInDouble && innerPrev !== '\\') {
          skipInSingle = !skipInSingle;
        } else if (inner === '"' && !skipInSingle && innerPrev !== '\\') {
          skipInDouble = !skipInDouble;
        } else if (!skipInSingle && !skipInDouble) {
          if (inner === '(') depth += 1;
          else if (inner === ')') depth -= 1;
        }
        i += 1;
      }
      i -= 1;
      continue;
    }

    if (ch === '`') {
      i += 1;
      while (i < source.length && source[i] !== '`') {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        i += 1;
      }
      continue;
    }

    if (ch === '(') {
      let depth = 1;
      let body = '';
      let bodyInSingle = false;
      let bodyInDouble = false;
      i += 1;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        const innerPrev = source[i - 1];
        if (inner === '\\' && !bodyInSingle) {
          body += inner;
          if (i + 1 < source.length) {
            body += source[i + 1];
            i += 2;
            continue;
          }
        }
        if (inner === "'" && !bodyInDouble && innerPrev !== '\\') {
          bodyInSingle = !bodyInSingle;
        } else if (inner === '"' && !bodyInSingle && innerPrev !== '\\') {
          bodyInDouble = !bodyInDouble;
        } else if (!bodyInSingle && !bodyInDouble) {
          if (inner === '(') {
            depth += 1;
          } else if (inner === ')') {
            depth -= 1;
            if (depth === 0) {
              break;
            }
          }
        }
        body += inner;
        i += 1;
      }
      if (body.trim()) {
        groups.push(body);
        groups.push(...extractSubshellGroups(body));
      }
    }
  }

  return groups;
}

function extractBraceGroups(input) {
  const source = String(input || '');
  const groups = [];
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];

    if (ch === '\\' && !inSingle) {
      i += 1;
      continue;
    }

    if (ch === "'" && !inDouble && prev !== '\\') {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle && prev !== '\\') {
      inDouble = !inDouble;
      continue;
    }

    if (inSingle || inDouble) {
      continue;
    }

    if (ch === '$' && source[i + 1] === '(') {
      let depth = 1;
      let skipInSingle = false;
      let skipInDouble = false;
      i += 2;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        const innerPrev = source[i - 1];
        if (inner === '\\' && !skipInSingle) {
          i += 2;
          continue;
        }
        if (inner === "'" && !skipInDouble && innerPrev !== '\\') {
          skipInSingle = !skipInSingle;
        } else if (inner === '"' && !skipInSingle && innerPrev !== '\\') {
          skipInDouble = !skipInDouble;
        } else if (!skipInSingle && !skipInDouble) {
          if (inner === '(') depth += 1;
          else if (inner === ')') depth -= 1;
        }
        i += 1;
      }
      i -= 1;
      continue;
    }

    if (ch === '`') {
      i += 1;
      while (i < source.length && source[i] !== '`') {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        i += 1;
      }
      continue;
    }

    if (ch === '(') {
      let depth = 1;
      let skipInSingle = false;
      let skipInDouble = false;
      i += 1;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        const innerPrev = source[i - 1];
        if (inner === '\\' && !skipInSingle) {
          i += 2;
          continue;
        }
        if (inner === "'" && !skipInDouble && innerPrev !== '\\') {
          skipInSingle = !skipInSingle;
        } else if (inner === '"' && !skipInSingle && innerPrev !== '\\') {
          skipInDouble = !skipInDouble;
        } else if (!skipInSingle && !skipInDouble) {
          if (inner === '(') depth += 1;
          else if (inner === ')') depth -= 1;
        }
        i += 1;
      }
      i -= 1;
      continue;
    }

    if (ch === '{' && /\s/.test(source[i + 1] || '')) {
      const prevIsBoundary = i === 0 || /[\s;|&(]/.test(prev);
      if (!prevIsBoundary) continue;

      let depth = 1;
      let body = '';
      let bodyInSingle = false;
      let bodyInDouble = false;
      i += 1;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        const innerPrev = source[i - 1];
        if (inner === '\\' && !bodyInSingle) {
          body += inner;
          if (i + 1 < source.length) {
            body += source[i + 1];
            i += 2;
            continue;
          }
        }
        if (inner === "'" && !bodyInDouble && innerPrev !== '\\') {
          bodyInSingle = !bodyInSingle;
          body += inner;
          i += 1;
          continue;
        }
        if (inner === '"' && !bodyInSingle && innerPrev !== '\\') {
          bodyInDouble = !bodyInDouble;
          body += inner;
          i += 1;
          continue;
        }
        if (bodyInSingle || bodyInDouble) {
          body += inner;
          i += 1;
          continue;
        }
        // Skip $(...) spans — a quoted `}` or `}`-as-text inside a
        // substitution body must not close the enclosing brace group.
        if (inner === '$' && source[i + 1] === '(') {
          body += inner + source[i + 1];
          let subDepth = 1;
          let subInSingle = false;
          let subInDouble = false;
          i += 2;
          while (i < source.length && subDepth > 0) {
            const c = source[i];
            const p = source[i - 1];
            body += c;
            if (c === '\\' && !subInSingle && i + 1 < source.length) {
              body += source[i + 1];
              i += 2;
              continue;
            }
            if (c === "'" && !subInDouble && p !== '\\') subInSingle = !subInSingle;
            else if (c === '"' && !subInSingle && p !== '\\') subInDouble = !subInDouble;
            else if (!subInSingle && !subInDouble) {
              if (c === '(') subDepth += 1;
              else if (c === ')') subDepth -= 1;
            }
            i += 1;
          }
          continue;
        }
        // Skip backtick spans for the same reason.
        if (inner === '`') {
          body += inner;
          i += 1;
          while (i < source.length && source[i] !== '`') {
            if (source[i] === '\\' && i + 1 < source.length) {
              body += source[i] + source[i + 1];
              i += 2;
              continue;
            }
            body += source[i];
            i += 1;
          }
          if (i < source.length) {
            body += source[i];
            i += 1;
          }
          continue;
        }
        // Skip plain (...) subshell spans for the same reason.
        if (inner === '(') {
          body += inner;
          let subDepth = 1;
          let subInSingle = false;
          let subInDouble = false;
          i += 1;
          while (i < source.length && subDepth > 0) {
            const c = source[i];
            const p = source[i - 1];
            body += c;
            if (c === '\\' && !subInSingle && i + 1 < source.length) {
              body += source[i + 1];
              i += 2;
              continue;
            }
            if (c === "'" && !subInDouble && p !== '\\') subInSingle = !subInSingle;
            else if (c === '"' && !subInSingle && p !== '\\') subInDouble = !subInDouble;
            else if (!subInSingle && !subInDouble) {
              if (c === '(') subDepth += 1;
              else if (c === ')') subDepth -= 1;
            }
            i += 1;
          }
          continue;
        }
        if (inner === '{' && /\s/.test(source[i + 1] || '')) {
          const nestedPrevIsBoundary = /[\s;|&(]/.test(innerPrev);
          if (nestedPrevIsBoundary) depth += 1;
        } else if (inner === '}' && (innerPrev === ';' || /\s/.test(innerPrev))) {
          depth -= 1;
          if (depth === 0) {
            break;
          }
        }
        body += inner;
        i += 1;
      }
      if (body.trim()) {
        groups.push(body);
        groups.push(...extractBraceGroups(body));
      }
    }
  }

  return groups;
}

// ============================================================================
// --- ECC destructive classifier (ecc@2.0.0/scripts/hooks/gateguard-fact-force.js, verbatim) ---
// ============================================================================

// SQL-keyword + dd patterns stay as a single regex — they are stable
// phrases without shell-flag ordering concerns. Quoted strings are
// stripped before this regex runs so a commit message mentioning
// "drop table" no longer triggers a false positive.
const DESTRUCTIVE_SQL_DD = /\b(drop\s+table|delete\s+from|truncate|dd\s+if=)\b/i;

/**
 * Strip the contents of single- and double-quoted strings so phrases
 * mentioned inside a commit message or echoed argument do not trigger
 * the destructive detector. Command substitutions are scanned separately
 * before this runs because they execute even inside double quotes.
 */
function stripQuotedStrings(input) {
  return input.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/**
 * Promote subshell delimiters to top-level segment separators so the
 * destructive check applies inside `$(...)` and backtick subshells.
 */
function explodeSubshells(input) {
  let out = input;
  for (let i = 0; i < 4; i += 1) {
    const before = out;
    out = out.replace(/\$\(([^()`]*)\)/g, ';$1;');
    out = out.replace(/`([^`]*)`/g, ';$1;');
    if (out === before) break;
  }
  return out;
}

/**
 * Split a command line into top-level segments at unquoted shell
 * separators (`;`, `|`, `&`, `&&`, `||`) and across subshells.
 */
function splitCommandSegments(input) {
  const stripped = explodeSubshells(stripQuotedStrings(input));
  return stripped
    .split(/[;|&]+/)
    .map(segment => segment.replace(/(^|\s)#.*/, '$1').trim())
    .filter(Boolean);
}

/**
 * Tokenize a single command segment by whitespace.
 */
function tokenize(segment) {
  return segment.split(/\s+/).filter(Boolean);
}

const SHELL_SEGMENT_SEPARATORS = new Set([';', '|', '&', '\n', '\r']);

/**
 * Quote-aware split of a command line into segments, with quotes removed from
 * the resulting words. Splits only on UNQUOTED `;`, `|`, `&`, and newlines
 * (GHSA-4v57-ph3x-gf55).
 */
function quoteAwareSegments(input) {
  const segments = [];
  let words = [];
  let current = '';
  let hasWord = false;
  let quote = null;
  let escaped = false;

  const flushWord = () => {
    if (hasWord) words.push(current);
    current = '';
    hasWord = false;
  };
  const flushSegment = () => {
    flushWord();
    if (words.length) segments.push(words);
    words = [];
  };

  for (const ch of String(input || '')) {
    if (escaped) {
      current += ch;
      hasWord = true;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      hasWord = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      hasWord = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasWord = true; // entering a quote starts a word, even if its content is empty
      continue;
    }
    if (SHELL_SEGMENT_SEPARATORS.has(ch)) {
      flushSegment();
      continue;
    }
    if (/\s/.test(ch)) {
      flushWord();
      continue;
    }
    current += ch;
    hasWord = true;
  }
  flushSegment();
  return segments;
}

const SHELL_WRAPPERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

/**
 * Quote-aware destructive check: catches quoted command words, newline
 * separators, quoted `find -exec`, and `sh -c`/`bash -c` wrappers
 * (GHSA-4v57-ph3x-gf55).
 */
function isDestructiveQuoteAware(raw, depth = 0) {
  if (depth > 4) return false;
  for (const tokens of quoteAwareSegments(raw)) {
    if (tokens.length === 0) continue;
    if (isDestructiveRm(tokens)) return true;
    if (isDestructiveGit(tokens)) return true;
    if (isDestructiveFindExec(tokens.join(' '))) return true;
    const base = commandBasename(tokens[0]);
    if (SHELL_WRAPPERS.has(base)) {
      const ci = tokens.indexOf('-c');
      if (ci !== -1 && tokens[ci + 1] && isDestructiveQuoteAware(tokens[ci + 1], depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Strip a leading path and trailing `.exe` from a command token so
 * `/usr/bin/git`, `git.exe`, and `GIT` all normalize to `git`.
 */
function commandBasename(token) {
  if (!token) return '';
  return token
    .replace(/^.*[\\/]/, '')
    .replace(/\.exe$/i, '')
    .toLowerCase();
}

/**
 * Detect `rm` invocations that recursively force-delete files. Handles
 * combined (`-rf`, `-fr`, `-Rf`) and split (`-r -f`) flag forms.
 */
function isDestructiveRm(tokens) {
  if (tokens.length === 0 || commandBasename(tokens[0]) !== 'rm') return false;
  let hasR = false;
  let hasF = false;
  for (const t of tokens.slice(1)) {
    if (t === '--recursive') {
      hasR = true;
      continue;
    }
    if (t === '--force') {
      hasF = true;
      continue;
    }
    if (!t.startsWith('-') || t.startsWith('--')) continue;
    const body = t.slice(1);
    if (/[rR]/.test(body)) hasR = true;
    if (/f/.test(body)) hasF = true;
  }
  return hasR && hasF;
}

/**
 * Locate the git subcommand within a token list, skipping over git's
 * global options like `-c key=value`, `-C <path>`, `--git-dir=...`, etc.
 */
function findGitSubcommand(tokens) {
  if (tokens.length === 0 || commandBasename(tokens[0]) !== 'git') return null;
  const valueConsumingShort = new Set(['-c', '-C']);
  const valueConsumingLong = new Set(['--git-dir', '--work-tree', '--namespace', '--super-prefix']);
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (valueConsumingShort.has(t) || valueConsumingLong.has(t)) {
      i += 2;
      continue;
    }
    if (t.startsWith('--git-dir=') || t.startsWith('--work-tree=') || t.startsWith('--namespace=') || t.startsWith('--super-prefix=')) {
      i += 1;
      continue;
    }
    if (t.startsWith('-')) {
      // Unknown global option — skip without consuming a value.
      i += 1;
      continue;
    }
    return { command: t.toLowerCase(), rest: tokens.slice(i + 1) };
  }
  return null;
}

/**
 * Detect destructive `git` invocations: `reset --hard`, `checkout --`,
 * `clean -f...`, `push --force` (but not `--force-with-lease`),
 * `commit --amend`, `rm -rf`, `switch --force`.
 */
function isDestructiveGit(tokens) {
  const sub = findGitSubcommand(tokens);
  if (!sub) return false;
  const { command, rest } = sub;

  if (command === 'reset') {
    return rest.includes('--hard');
  }

  if (command === 'checkout') {
    return rest.some(t => {
      if (t === '--' || t === '.' || t === '--force') return true;
      if (!t.startsWith('-') || t.startsWith('--')) return false;
      return t.slice(1).includes('f');
    });
  }

  if (command === 'clean') {
    return rest.some(t => {
      if (t === '--force') return true;
      if (!t.startsWith('-') || t.startsWith('--')) return false;
      return t.slice(1).includes('f');
    });
  }

  if (command === 'push') {
    // Only `--force-with-lease` qualifies as a safety-checked force.
    // A `+` refspec prefix also forces a non-fast-forward update.
    let withLease = false;
    let bareForce = false;
    let plusRefspecForce = false;
    for (const t of rest) {
      if (t === '--force-with-lease' || t.startsWith('--force-with-lease=')) {
        withLease = true;
        continue;
      }
      if (t === '--force' || t.startsWith('--force=')) {
        bareForce = true;
        continue;
      }
      if (t.startsWith('-') && !t.startsWith('--') && t.slice(1).includes('f')) {
        bareForce = true;
        continue;
      }
      if (t.startsWith('+') && t.length > 1 && /^\+(?:[a-zA-Z_/.:]|HEAD)/.test(t)) {
        plusRefspecForce = true;
      }
    }
    return bareForce || (plusRefspecForce && !withLease);
  }

  if (command === 'commit') {
    return rest.includes('--amend');
  }

  if (command === 'rm') {
    let hasR = false;
    for (const t of rest) {
      if (!t.startsWith('-') || t.startsWith('--')) continue;
      if (/[rR]/.test(t.slice(1))) hasR = true;
    }
    return hasR;
  }

  if (command === 'switch') {
    return rest.some(t => {
      if (t === '--discard-changes' || t === '--force') return true;
      if (!t.startsWith('-') || t.startsWith('--')) return false;
      const body = t.slice(1);
      return /[fC]/.test(body);
    });
  }

  return false;
}

/**
 * Walk every executable body reachable from a raw command line and
 * return them as a flat list (`$(...)`, backticks, `(...)` subshells,
 * and `{ ...; }` brace groups, cross-syntax via BFS).
 */
function collectExecutableBodies(raw) {
  const bodies = [raw];
  const queue = [raw];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);

    for (const body of extractCommandSubstitutions(current)) {
      if (seen.has(body)) continue;
      bodies.push(body);
      queue.push(body);
    }
    for (const body of extractSubshellGroups(current)) {
      if (seen.has(body)) continue;
      bodies.push(body);
      queue.push(body);
    }
    for (const body of extractBraceGroups(current)) {
      if (seen.has(body)) continue;
      bodies.push(body);
      queue.push(body);
    }
  }

  return bodies;
}

/**
 * Detect destructive commands inside `find ... -exec` invocations.
 */
function isDestructiveFindExec(command) {
  const raw = String(command || '');
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }

  const tokens = tokenize(trimmed);
  if (!tokens || tokens.length === 0) {
    return false;
  }

  if (commandBasename(tokens[0]) !== 'find') {
    return false;
  }

  const execIndex = tokens.indexOf('-exec');
  if (execIndex === -1) {
    return false;
  }

  const execTokens = [];
  for (let i = execIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === ';' || token === '\\;' || token === '+') {
      break;
    }
    execTokens.push(token);
  }

  if (execTokens.length === 0) {
    return false;
  }

  const baseCmd = commandBasename(execTokens[0]);

  if (baseCmd === 'rmdir' || baseCmd === 'unlink') {
    return true;
  }

  if (baseCmd === 'rm') {
    return true;
  }

  if (baseCmd === 'git') {
    const sub = findGitSubcommand(execTokens);
    if (sub && sub.command === 'reset' && sub.rest.includes('--hard')) {
      return true;
    }
  }

  return false;
}

/**
 * Decide whether a bash command line contains a destructive action
 * (Category B). Combines SQL-keyword detection with per-segment shell
 * tokenization and the quote-aware pass.
 */
function isDestructiveBash(command) {
  const raw = String(command || '');
  const flattened = explodeSubshells(stripQuotedStrings(raw));
  if (DESTRUCTIVE_SQL_DD.test(flattened)) return true;

  // find -exec on raw body segments (before quote-stripping) so quoted exec
  // binaries and compound-command prefixes are both handled correctly.
  const bodies = collectExecutableBodies(raw);
  for (const body of bodies) {
    for (const rawSeg of body
      .split(/[;|&]+/)
      .map(s => s.trim())
      .filter(Boolean)) {
      if (isDestructiveFindExec(rawSeg)) return true;
    }
  }

  const segments = bodies.flatMap(splitCommandSegments);
  for (const segment of segments) {
    const stripped = stripQuotedStrings(segment);
    if (DESTRUCTIVE_SQL_DD.test(stripped)) return true;
    const tokens = tokenize(segment);
    if (isDestructiveRm(tokens)) return true;
    if (isDestructiveGit(tokens)) return true;
  }

  // Quote-aware pass: closes the quoted-command-word, newline-separator,
  // quoted-find-exec, and sh/bash -c bypasses (GHSA-4v57-ph3x-gf55).
  if (isDestructiveQuoteAware(raw)) return true;

  return false;
}

// ============================================================================
// --- kb credential-store classifier (Category A — NOT from ECC) ---
// ============================================================================
//
// Enforces the constitution's absolute hard ceiling: "never handle credentials
// as objects (create/read stores/modify)". The ECC source has NO credential
// detection; this section is kb-authored, built on the SAME quote-aware /
// subshell-aware machinery extracted above so quoting (`cat '~/.ssh/id_rsa'`)
// or command substitution (`echo $(cat ~/.ssh/id_rsa)`) cannot bypass it.

// Credential-store PATH patterns (matched against every dequoted token, across
// every executable body). Touching one of these paths at all — read, write, or
// delete — is the hard ceiling.
const CRED_PATH_PATTERNS = [
  // `.env` secrets file: bare `.env` or dotted variant (`.env.local`,
  // `.env.production`). Anchored to a path boundary so `environment` /
  // `.eslintrc` do not match. Template variants are excluded below.
  { re: /(^|[\\/~])\.env(\.[^\\/]*)?$/i, kind: '.env secrets file' },
  // `~/.ssh` tree (private keys, known_hosts, config).
  { re: /(^|[\\/~])\.ssh([\\/]|$)/i, kind: '~/.ssh credential directory' },
  // `~/.aws` tree (credentials, config).
  { re: /(^|[\\/~])\.aws([\\/]|$)/i, kind: '~/.aws credential directory' },
  // `~/.gnupg` private keyring.
  { re: /(^|[\\/~])\.gnupg([\\/]|$)/i, kind: '~/.gnupg keyring' },
];

// `.env` filename suffixes that are committed TEMPLATES, not secret stores.
// A token whose `.env` suffix is one of these is NOT a credential store.
const ENV_TEMPLATE_SUFFIXES = new Set(['.example', '.sample', '.template', '.dist']);

function isEnvTemplateToken(token) {
  const m = /(^|[\\/~])\.env(\.[^\\/]*)?$/i.exec(token);
  if (!m) return false;
  const suffix = (m[2] || '').toLowerCase();
  return ENV_TEMPLATE_SUFFIXES.has(suffix);
}

function tokenIsCredentialPath(token) {
  if (isEnvTemplateToken(token)) return false;
  return CRED_PATH_PATTERNS.some(p => p.re.test(token));
}

// Credential-store TOOL invocations, keyed on the command basename of a
// segment (tokens[0]) so `pip install keyring` (basename `pip`) does not
// false-positive. Value = required accompanying argument matcher, or null
// when the tool name alone is the signal.
const CRED_TOOLS = {
  keyring: null,               // python keyring CLI: `keyring get svc user`
  'secret-tool': null,         // libsecret: `secret-tool lookup ...`
  cmdkey: null,                // Windows Credential Manager
  'wincred': null,             // Windows credential helper
  security: /\bfind-(generic|internet)-password\b/i, // macOS keychain read
};

// Credential-MINTING phrases (constitution ceiling: never create cred stores).
// Matched against the joined, dequoted tokens of a segment.
const CRED_MINT_PATTERNS = [
  /\bsetup-token\b/i,                          // `claude setup-token`
  /\bauth\s+token\b/i,                         // `gh auth token`
  /\bsts\s+get-(session|federation)-token\b/i, // `aws sts get-session-token`
  /\bauth\s+print-(access|identity)-token\b/i, // `gcloud auth print-access-token`
];

// DPAPI / Windows protected-data access via PowerShell.
const CRED_DPAPI_PATTERNS = [/\bunprotect(-|data)/i, /\bprotecteddata\b/i, /\bdpapi\b/i];
const POWERSHELL_BASES = new Set(['powershell', 'pwsh']);

/**
 * Category A: does this command read/write/mint a credential store? Built on
 * the quote-aware, subshell-aware machinery so quoting and `$(...)` cannot
 * hide the access. Fail-open on empty input (handled by the caller).
 */
function isCredentialAccess(command) {
  const raw = String(command || '');
  const bodies = collectExecutableBodies(raw);

  for (const body of bodies) {
    for (const tokens of quoteAwareSegments(body)) {
      if (tokens.length === 0) continue;

      // 1. Any token that references a credential-store path.
      for (const tok of tokens) {
        if (tokenIsCredentialPath(tok)) return true;
      }

      const base = commandBasename(tokens[0]);
      const joined = tokens.join(' ');

      // 2. Credential-store tool invocation (keyed on the command basename).
      if (Object.prototype.hasOwnProperty.call(CRED_TOOLS, base)) {
        const argMatcher = CRED_TOOLS[base];
        if (argMatcher === null || argMatcher.test(joined)) return true;
      }

      // 3. Credential minting.
      if (CRED_MINT_PATTERNS.some(re => re.test(joined))) return true;

      // 4. DPAPI / protected-data access via PowerShell.
      if (POWERSHELL_BASES.has(base) && CRED_DPAPI_PATTERNS.some(re => re.test(joined))) {
        return true;
      }
    }
  }

  return false;
}

module.exports = {
  isDestructiveBash,
  isCredentialAccess,
  // Exposed for unit reuse / testing.
  isCredentialPathToken: tokenIsCredentialPath,
  commandBasename,
};
