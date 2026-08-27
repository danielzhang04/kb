import { BridgeError } from './errors.js';

interface Token {
  readonly kind: 'punctuation' | 'string' | 'scalar';
  readonly raw: string;
  readonly overflow: boolean;
}

interface ObjectFrame {
  readonly kind: 'object';
  readonly path: readonly string[];
  state: 'key-or-end' | 'colon' | 'value' | 'comma-or-end';
  key?: string;
  count: number;
}

interface ArrayFrame {
  readonly kind: 'array';
  readonly path: readonly string[];
  state: 'value-or-end' | 'comma-or-end';
  index: number;
}

type Frame = ObjectFrame | ArrayFrame;

interface Capture {
  readonly target: 'summary' | 'row';
  readonly key?: string;
  readonly closeDepth?: number;
  raw: string;
  bytes: number;
  overflow: boolean;
}

interface MetricCapture {
  readonly name: string;
  readonly type: 'array' | 'object' | 'scalar';
  readonly closeDepth?: number;
  bytes: number;
}

export interface IndexKeyMetric {
  readonly name: string;
  readonly elements: number;
  readonly bytes: number;
}

export interface IndexProjection {
  readonly summary: Readonly<Record<string, unknown>>;
  readonly rows: readonly unknown[];
  readonly rowCount: number;
  readonly keys: readonly IndexKeyMetric[];
}

const TOKEN_BYTES = 64 * 1024;
const GRADES_PATH = 'ledgers.grades.rows';

class Tokenizer {
  private mode: 'normal' | 'string' | 'scalar' = 'normal';
  private raw = '';
  private bytes = 0;
  private overflow = false;
  private escaped = false;

  push(text: string): Token[] {
    const tokens: Token[] = [];
    for (let index = 0; index < text.length;) {
      const character = text[index];
      if (this.mode === 'normal') {
        if (/\s/.test(character)) {
          index += 1;
        } else if ('{}[]:,'.includes(character)) {
          tokens.push({ kind: 'punctuation', raw: character, overflow: false });
          index += 1;
        } else {
          this.start(character === '"' ? 'string' : 'scalar');
          this.append(character);
          index += 1;
        }
        continue;
      }
      if (this.mode === 'scalar') {
        if (/\s/.test(character) || '{}[]:,'.includes(character)) {
          tokens.push(this.take('scalar'));
          continue;
        }
        this.append(character);
        index += 1;
        continue;
      }
      this.append(character);
      index += 1;
      if (this.escaped) {
        this.escaped = false;
      } else if (character === '\\') {
        this.escaped = true;
      } else if (character === '"') {
        tokens.push(this.take('string'));
      }
    }
    return tokens;
  }

  finish(): Token[] {
    if (this.mode === 'string') throw malformedIndex();
    return this.mode === 'scalar' ? [this.take('scalar')] : [];
  }

  private start(mode: 'string' | 'scalar'): void {
    this.mode = mode;
    this.raw = '';
    this.bytes = 0;
    this.overflow = false;
    this.escaped = false;
  }

  private append(value: string): void {
    const bytes = Buffer.byteLength(value, 'utf8');
    this.bytes += bytes;
    if (this.bytes <= TOKEN_BYTES) this.raw += value;
    else this.overflow = true;
  }

  private take(kind: 'string' | 'scalar'): Token {
    const token = { kind, raw: this.raw, overflow: this.overflow } satisfies Token;
    this.mode = 'normal';
    this.raw = '';
    this.bytes = 0;
    this.overflow = false;
    return token;
  }
}

export class IndexStreamExtractor {
  private readonly tokenizer = new Tokenizer();
  private readonly frames: Frame[] = [];
  private readonly summary: Record<string, unknown> = {};
  private readonly rows: unknown[] = [];
  private readonly keys: IndexKeyMetric[] = [];
  private capture?: Capture;
  private metric?: MetricCapture;
  private rowCount = 0;
  private rootSeen = false;
  private rootComplete = false;

  constructor(
    private readonly rowLimit: number,
    private readonly resultBytes: number,
    private readonly summaryKeys: ReadonlySet<string>,
  ) {}

  push(text: string): void {
    for (const token of this.tokenizer.push(text)) this.consume(token);
  }

  finish(): IndexProjection {
    for (const token of this.tokenizer.finish()) this.consume(token);
    if (!this.rootComplete || this.frames.length !== 0 || this.capture) throw malformedIndex();
    return { summary: this.summary, rows: this.rows, rowCount: this.rowCount, keys: this.keys };
  }

  private consume(token: Token): void {
    if (this.rootComplete) throw malformedIndex();
    this.appendCapture(token);
    this.appendMetric(token);
    const frame = this.frames.at(-1);

    if (token.kind === 'punctuation') {
      if (token.raw === '{' || token.raw === '[') {
        const path = this.beginValue(token, true);
        this.startMetric(path, token, true);
        this.frames.push(token.raw === '{'
          ? { kind: 'object', path, state: 'key-or-end', count: 0 }
          : { kind: 'array', path, state: 'value-or-end', index: 0 });
        return;
      }
      if (token.raw === '}' || token.raw === ']') {
        if (!frame || (token.raw === '}' ? frame.kind !== 'object' : frame.kind !== 'array')) throw malformedIndex();
        if (frame.kind === 'object' && !['key-or-end', 'comma-or-end'].includes(frame.state)) throw malformedIndex();
        if (frame.kind === 'array' && !['value-or-end', 'comma-or-end'].includes(frame.state)) throw malformedIndex();
        const closingDepth = this.frames.length;
        if (this.metric?.closeDepth === closingDepth) {
          this.finishMetric(frame.kind === 'array' ? frame.index : frame.count);
        }
        this.frames.pop();
        if (this.capture?.closeDepth === closingDepth) this.finishCapture();
        this.completeValue();
        return;
      }
      if (token.raw === ':') {
        if (!frame || frame.kind !== 'object' || frame.state !== 'colon') throw malformedIndex();
        frame.state = 'value';
        return;
      }
      if (token.raw === ',') {
        if (!frame || frame.state !== 'comma-or-end') throw malformedIndex();
        if (frame.kind === 'object') {
          frame.state = 'key-or-end';
          frame.key = undefined;
        } else {
          frame.state = 'value-or-end';
        }
        return;
      }
      throw malformedIndex();
    }

    if (frame?.kind === 'object' && frame.state === 'key-or-end') {
      if (token.kind !== 'string' || token.overflow) throw malformedIndex();
      const key = parseToken(token);
      if (typeof key !== 'string') throw malformedIndex();
      frame.key = key;
      frame.state = 'colon';
      return;
    }
    const path = this.beginValue(token, false);
    this.startMetric(path, token, false);
    if (this.capture?.closeDepth === undefined) this.finishCapture();
    if (this.metric?.closeDepth === undefined) this.finishMetric(1);
    this.completeValue();
  }

  private beginValue(token: Token, container: boolean): readonly string[] {
    const parent = this.frames.at(-1);
    let path: readonly string[];
    if (!parent) {
      if (this.rootSeen) throw malformedIndex();
      this.rootSeen = true;
      path = [];
    } else if (parent.kind === 'object') {
      if (parent.state !== 'value' || parent.key === undefined) throw malformedIndex();
      path = [...parent.path, parent.key];
    } else {
      if (parent.state !== 'value-or-end') throw malformedIndex();
      path = [...parent.path, String(parent.index)];
    }

    const summaryKey = path.length === 1 && this.summaryKeys.has(path[0]) ? path[0] : undefined;
    const isGradeRow = parent?.kind === 'array' && parent.path.join('.') === GRADES_PATH;
    if (isGradeRow) this.rowCount += 1;
    const gradeRow = isGradeRow && this.rows.length < this.rowLimit;
    if (summaryKey || gradeRow) {
      this.capture = {
        target: summaryKey ? 'summary' : 'row', key: summaryKey,
        ...(container ? { closeDepth: this.frames.length + 1 } : {}),
        raw: token.raw, bytes: Buffer.byteLength(token.raw, 'utf8'), overflow: token.overflow,
      };
      if (this.capture.bytes > this.resultBytes) this.capture.overflow = true;
    }
    return path;
  }

  private appendCapture(token: Token): void {
    if (!this.capture) return;
    this.capture.bytes += Buffer.byteLength(token.raw, 'utf8');
    if (token.overflow || this.capture.bytes > this.resultBytes) {
      this.capture.overflow = true;
      return;
    }
    this.capture.raw += token.raw;
  }

  private startMetric(path: readonly string[], token: Token, container: boolean): void {
    if (path.length !== 1 || this.keys.length >= 40) return;
    this.metric = {
      name: path[0], type: container ? (token.raw === '[' ? 'array' : 'object') : 'scalar',
      ...(container ? { closeDepth: this.frames.length + 1 } : {}),
      bytes: Buffer.byteLength(token.raw, 'utf8'),
    };
  }

  private appendMetric(token: Token): void {
    if (this.metric) this.metric.bytes += Buffer.byteLength(token.raw, 'utf8');
  }

  private finishMetric(elements: number): void {
    if (!this.metric) return;
    this.keys.push({ name: this.metric.name, elements, bytes: this.metric.bytes });
    this.metric = undefined;
  }

  private finishCapture(): void {
    const capture = this.capture;
    if (!capture) return;
    this.capture = undefined;
    if (capture.overflow) return;
    const value = parseRaw(capture.raw);
    if (capture.target === 'summary' && capture.key) {
      const candidate = { ...this.summary, [capture.key]: value };
      if (jsonBytes(candidate) <= this.resultBytes) this.summary[capture.key] = value;
    } else {
      const candidate = [...this.rows, value];
      if (jsonBytes({ rows: candidate }) <= this.resultBytes) this.rows.push(value);
    }
  }

  private completeValue(): void {
    const parent = this.frames.at(-1);
    if (!parent) {
      this.rootComplete = true;
    } else if (parent.kind === 'object') {
      if (parent.state !== 'value') throw malformedIndex();
      parent.count += 1;
      parent.state = 'comma-or-end';
    } else {
      if (parent.state !== 'value-or-end') throw malformedIndex();
      parent.index += 1;
      parent.state = 'comma-or-end';
    }
  }
}

function parseToken(token: Token): unknown {
  if (token.overflow) throw malformedIndex();
  return parseRaw(token.raw);
}

function parseRaw(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw malformedIndex();
  }
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function malformedIndex(): BridgeError {
  return new BridgeError('dashboard_error', 'dashboard index response is malformed');
}
