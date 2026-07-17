import { describe, it, expect } from 'vitest';
import { parseYaml, serializeOverride, coerceScalar } from './yaml.ts';

/** The real governance/model-routing.yaml §1 shape (nested block maps + inline flow). */
const POLICY_YAML = `# comment line
version: 1
runtimes:
  claude:
    default_worker: worker-desktop
    aliases:
      opus: claude-opus-4-8
      sonnet: claude-sonnet-5
      haiku: claude-haiku-4-5
    known_models: [claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5]
  codex:
    default_worker: codex-worker  # trailing comment
    aliases:
      codex: gpt-5.6-sol
    known_models: [gpt-5.6-sol]
policy:
  scout:
    "*": { runtime: claude, model: haiku }
  work:
    T1: { runtime: claude, model: sonnet }
    T3: { runtime: claude, model: opus }
role_default: { runtime: claude, model: sonnet }
`;

describe('parseYaml — policy shape', () => {
  const doc = parseYaml(POLICY_YAML) as Record<string, any>;

  it('parses top-level scalars and the version', () => {
    expect(doc.version).toBe(1);
  });

  it('parses the nested runtimes registry with aliases + known_models', () => {
    expect(doc.runtimes.claude.default_worker).toBe('worker-desktop');
    expect(doc.runtimes.claude.aliases).toEqual({
      opus: 'claude-opus-4-8',
      sonnet: 'claude-sonnet-5',
      haiku: 'claude-haiku-4-5',
    });
    expect(doc.runtimes.claude.known_models).toEqual([
      'claude-opus-4-8',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ]);
    expect(doc.runtimes.codex.default_worker).toBe('codex-worker');
    expect(doc.runtimes.codex.known_models).toEqual(['gpt-5.6-sol']);
  });

  it('parses the role x tier matrix incl. a quoted "*" key and inline flow maps', () => {
    expect(doc.policy.scout['*']).toEqual({ runtime: 'claude', model: 'haiku' });
    expect(doc.policy.work.T1).toEqual({ runtime: 'claude', model: 'sonnet' });
    expect(doc.policy.work.T3).toEqual({ runtime: 'claude', model: 'opus' });
  });

  it('parses role_default as an inline flow map', () => {
    expect(doc.role_default).toEqual({ runtime: 'claude', model: 'sonnet' });
  });
});

const OVERRIDE_YAML = `version: 1
overrides:
  - scope: agent
    key: codex-worker
    runtime: claude
    model: claude-opus-4-8
    expires: 2026-07-18T00:00:00Z
    set-by: daniel@webauthn
    set-at: 2026-07-17T14:03:00Z
  - scope: card
    key: 6a5950ae-19654711
    model: claude-sonnet-5
    expires: null
`;

describe('parseYaml — override shape (block sequence of maps)', () => {
  const doc = parseYaml(OVERRIDE_YAML) as Record<string, any>;

  it('parses the overrides list with all fields', () => {
    expect(doc.version).toBe(1);
    expect(Array.isArray(doc.overrides)).toBe(true);
    expect(doc.overrides).toHaveLength(2);
    expect(doc.overrides[0]).toEqual({
      scope: 'agent',
      key: 'codex-worker',
      runtime: 'claude',
      model: 'claude-opus-4-8',
      expires: '2026-07-18T00:00:00Z',
      'set-by': 'daniel@webauthn',
      'set-at': '2026-07-17T14:03:00Z',
    });
  });

  it('parses a partial (model-only) entry and an explicit null expiry', () => {
    expect(doc.overrides[1]).toEqual({
      scope: 'card',
      key: '6a5950ae-19654711',
      model: 'claude-sonnet-5',
      expires: null,
    });
  });

  it('parses the same-indent block-sequence style', () => {
    const same = parseYaml('overrides:\n- scope: agent\n  key: a\n') as Record<string, any>;
    expect(same.overrides).toEqual([{ scope: 'agent', key: 'a' }]);
  });

  it('parses an empty flow sequence for overrides: []', () => {
    const empty = parseYaml('version: 1\noverrides: []\n') as Record<string, any>;
    expect(empty.overrides).toEqual([]);
  });
});

describe('coerceScalar', () => {
  it('coerces null/bool/int/quoted forms', () => {
    expect(coerceScalar('null')).toBeNull();
    expect(coerceScalar('~')).toBeNull();
    expect(coerceScalar('')).toBeNull();
    expect(coerceScalar('true')).toBe(true);
    expect(coerceScalar('false')).toBe(false);
    expect(coerceScalar('42')).toBe(42);
    expect(coerceScalar('"*"')).toBe('*');
    expect(coerceScalar('claude-opus-4-8')).toBe('claude-opus-4-8');
  });
});

describe('serializeOverride — round-trips through parseYaml', () => {
  it('emits overrides: [] for an empty document', () => {
    const text = serializeOverride({ version: 1, overrides: [] });
    expect(text).toContain('overrides: []');
    expect(parseYaml(text)).toMatchObject({ version: 1, overrides: [] });
  });

  it('emits + re-parses a full entry identically', () => {
    const doc = {
      version: 1,
      overrides: [
        {
          scope: 'agent',
          key: 'worker-desktop',
          runtime: 'claude',
          model: 'claude-opus-4-8',
          expires: '2026-07-18T00:00:00Z',
          'set-by': 'daniel@webauthn',
          'set-at': '2026-07-17T14:03:00Z',
        },
      ],
    };
    const round = parseYaml(serializeOverride(doc)) as Record<string, any>;
    expect(round.overrides[0]).toEqual(doc.overrides[0]);
  });

  it('keeps a partial (model-only) entry partial and emits explicit null expiry', () => {
    const text = serializeOverride({
      version: 1,
      overrides: [{ scope: 'card', key: 'card-1', model: 'claude-sonnet-5', expires: null }],
    });
    const round = parseYaml(text) as Record<string, any>;
    expect(round.overrides[0]).toEqual({ scope: 'card', key: 'card-1', model: 'claude-sonnet-5', expires: null });
    expect(text).not.toContain('runtime:');
  });

  it('quotes a "*" key value so it never re-parses as an alias/anchor', () => {
    const text = serializeOverride({ version: 1, overrides: [{ scope: 'agent', key: '*' }] });
    const round = parseYaml(text) as Record<string, any>;
    expect(round.overrides[0].key).toBe('*');
  });
});

describe('serializeOverride — allowlist quoting (LOW-2/LOW-3)', () => {
  // A field whose string value would be mis-read (or corrupt the file) if emitted bare must survive
  // serialize->parse with EXACT string identity under THIS parser. The two gaps LOW-2/LOW-3 flagged in
  // the old denylist emitScalar: raw control chars (\n/\r/\t) emitted bare, and YAML-coercible tokens
  // ("null"/"true"/"123") emitted bare then re-read as null/bool/number (string identity lost).
  //
  // Cross-parser note (manual, since the py suite has no shared TS fixture): the same serialized bytes
  // load identically under Python `yaml.safe_load` — a double-quoted scalar unescapes \n/\t the same way
  // and a quoted "null"/"123" stays a str. Verified manually during this fix with:
  //   py -3 -c "import yaml; print(yaml.safe_load(open('<file>').read()))"
  function roundTripKey(v: string): unknown {
    const text = serializeOverride({ version: 1, overrides: [{ scope: 'agent', key: v }] });
    return (parseYaml(text) as any).overrides[0].key;
  }

  it('preserves a newline-bearing string exactly (a control char is never emitted bare)', () => {
    expect(roundTripKey('ab\ncd')).toBe('ab\ncd');
  });
  it('preserves a tab-bearing string exactly', () => {
    expect(roundTripKey('a\tb')).toBe('a\tb');
  });
  it('preserves a carriage-return string exactly', () => {
    expect(roundTripKey('a\rb')).toBe('a\rb');
  });
  it('keeps YAML-coercible tokens as STRINGS (not coerced to null/bool/number)', () => {
    for (const tok of ['null', '~', 'true', 'false', 'yes', 'no', 'on', 'off', '123', '-5', '3.14']) {
      expect(roundTripKey(tok), tok).toBe(tok);
    }
  });
  it('never leaves a raw control char in the serialized bytes; value stays one physical line', () => {
    const text = serializeOverride({ version: 1, overrides: [{ scope: 'agent', key: 'x\ny', model: 'a\tb' }] });
    for (const line of text.split('\n')) expect(line).not.toMatch(/[\t\r]/);
    expect(text).toContain('key: "x\\ny"');
    expect(text).toContain('model: "a\\tb"');
  });
  it('still emits safe ids bare and quotes YAML-special "*"', () => {
    const text = serializeOverride({
      version: 1,
      overrides: [{ scope: 'agent', key: 'worker-desktop', model: 'claude-opus-4-8', 'set-by': 'daniel@webauthn' }],
    });
    expect(text).toContain('key: worker-desktop');
    expect(text).toContain('model: claude-opus-4-8');
    expect(text).toContain('set-by: daniel@webauthn');
    expect(serializeOverride({ version: 1, overrides: [{ scope: 'agent', key: '*' }] })).toContain('key: "*"');
  });
});
