/**
 * D3.1h — wire-protocol framing. Pure/hermetic. The load-bearing property under test: because every frame
 * is JSON-stringified, a PTY `data` chunk containing raw newlines/control chars is still exactly ONE
 * physical line, so streaming output can never desync the control-frame demultiplexer.
 */
import { describe, expect, it } from 'vitest';
import { encodeFrame, FrameParser } from './ptyProtocol.ts';
import type { ControlFrame } from './ptyProtocol.ts';

describe('encodeFrame', () => {
  it('encodes each frame as a single newline-terminated line', () => {
    const line = encodeFrame({ type: 'open-ack', sessionId: 'pty-1' });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.indexOf('\n')).toBe(line.length - 1); // exactly one newline, at the end
    expect(JSON.parse(line.trimEnd())).toEqual({ type: 'open-ack', sessionId: 'pty-1' });
  });

  it('a data chunk full of raw newlines/control chars stays ONE physical line (framing-safe)', () => {
    const nasty = 'line1\nline2\r\n[2Jmore\n';
    const line = encodeFrame({ type: 'data', data: nasty });
    // Exactly one physical newline (the terminator) — the embedded newlines are JSON-escaped.
    expect(line.split('\n').length).toBe(2); // content + trailing empty after final \n
    const round = JSON.parse(line.trimEnd()) as ControlFrame;
    expect(round).toEqual({ type: 'data', data: nasty });
  });
});

describe('FrameParser', () => {
  it('parses multiple frames across arbitrary chunk boundaries', () => {
    const p = new FrameParser();
    const a = encodeFrame({ type: 'write', data: 'ls\n' });
    const b = encodeFrame({ type: 'resize', cols: 100, rows: 40 });
    // Split the concatenated stream at a byte boundary INSIDE the first frame.
    const stream = a + b;
    const cut = 5;
    const first = p.push(stream.slice(0, cut));
    expect(first).toEqual([]); // no complete line yet
    const rest = p.push(stream.slice(cut));
    expect(rest).toEqual([
      { type: 'write', data: 'ls\n' },
      { type: 'resize', cols: 100, rows: 40 },
    ]);
  });

  it('round-trips a data frame whose payload contains newlines without splitting it', () => {
    const p = new FrameParser();
    const frames = p.push(encodeFrame({ type: 'data', data: 'a\nb\nc' }));
    expect(frames).toEqual([{ type: 'data', data: 'a\nb\nc' }]);
  });

  it('tolerates blank lines (keep-alives)', () => {
    const p = new FrameParser();
    expect(p.push('\n\n' + encodeFrame({ type: 'stop' }))).toEqual([{ type: 'stop' }]);
  });

  it('FAILS CLOSED on a malformed (non-JSON) line', () => {
    const p = new FrameParser();
    expect(() => p.push('not json\n')).toThrow(/malformed frame/);
  });

  it('FAILS CLOSED on a JSON value that is not an object (array/scalar)', () => {
    expect(() => new FrameParser().push('[1,2,3]\n')).toThrow(/not a JSON object/);
    expect(() => new FrameParser().push('42\n')).toThrow(/not a JSON object/);
  });

  it('FAILS CLOSED on an over-long line with no newline (memory-exhaustion defense)', () => {
    const p = new FrameParser(16);
    expect(() => p.push('x'.repeat(64))).toThrow(/exceeded 16 bytes/);
  });
});
