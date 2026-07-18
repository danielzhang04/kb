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

describe('D3.1 MED mitigation — challenge frame + assertion-carrying open', () => {
  it('round-trips a host-issued challenge frame', () => {
    const p = new FrameParser();
    const challenge = 'WyJrYi1wdHktb3BlbiIsImRHVnpkQzF1YjI1alpRIl0';
    const frames = p.push(encodeFrame({ type: 'challenge', challenge }));
    expect(frames).toEqual([{ type: 'challenge', challenge }]);
  });

  it('round-trips an open frame carrying a passkey assertion (Factor C)', () => {
    const open: ControlFrame = {
      type: 'open',
      token: 'boot-token',
      requestId: 'req-1',
      cols: 80,
      rows: 24,
      cwd: '/repo',
      sessionSubject: 'operator-1',
      assertion: {
        credentialId: 'cred-abc',
        authenticatorData: 'YXV0aA',
        clientDataJSON: 'Y2RhdGE',
        signature: 'c2ln',
      },
    };
    const frames = new FrameParser().push(encodeFrame(open));
    expect(frames).toEqual([open]);
  });

  it('an open frame WITHOUT an assertion still round-trips (assertion is optional on the wire)', () => {
    const open: ControlFrame = {
      type: 'open',
      token: 'boot',
      requestId: 'r',
      cols: 80,
      rows: 24,
      cwd: '/repo',
      sessionSubject: 's',
    };
    expect(new FrameParser().push(encodeFrame(open))).toEqual([open]);
  });

  it('an oversize assertion-bearing open (no newline yet) FAILS CLOSED at the line ceiling', () => {
    const p = new FrameParser(64);
    // Strip the trailing newline so the parser sees an unterminated over-long line (memory-exhaustion guard).
    const huge = encodeFrame({
      type: 'open',
      token: 't',
      requestId: 'r',
      cols: 80,
      rows: 24,
      cwd: '/repo',
      sessionSubject: 's',
      assertion: { credentialId: 'c', authenticatorData: 'A'.repeat(200), clientDataJSON: 'x', signature: 'y' },
    }).replace(/\n$/, '');
    expect(() => p.push(huge)).toThrow(/exceeded 64 bytes/);
  });

  it('a challenge frame with embedded control chars stays ONE physical line (framing-safe)', () => {
    const p = new FrameParser();
    const challenge = 'has\nnewline\tand\rreturn';
    expect(p.push(encodeFrame({ type: 'challenge', challenge }))).toEqual([{ type: 'challenge', challenge }]);
  });
});
