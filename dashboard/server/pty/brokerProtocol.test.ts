import { describe, expect, it } from 'vitest';

import {
  invalidPtyProtocolVectors,
  validBrokerClientFrames,
  validBrokerServerFrames,
} from '../../shared/ptyProtocolVectors.ts';
import {
  BROKER_MAX_FRAME_BYTES,
  BROKER_MAX_INPUT_BYTES,
  BROKER_MAX_QUEUED_INPUT_BYTES,
  BrokerFrameDecoder,
  BrokerProtocolError,
  decodeBrokerClientFrame,
  decodeBrokerServerFrame,
  encodeBrokerFrame,
} from './brokerProtocol.ts';

const epochId = 'epoch-0123456789abcdef0123456789abcdef';

/**
 * Every shared vector, mapped to the rule the *broker* decoder applies to it.
 * `owner: 'W4'` marks a browser-frame vector: the broker decoder kills it on type/key dispatch
 * long before its intended rule, so W4's browser decoder — not this suite — owns it.
 * `message` is the broker's own first refusal; where the broker's exact key set fires before the
 * rule the case is named for, `reaches` repairs the frame into broker shape so the named rule runs.
 */
const brokerVectorRules: Record<string, { owner: 'W4' } | {
  message: string;
  refusal?: string;
  marker?: 'rawBytes' | 'queuedBytes' | 'decodedBytes';
  reaches?: { frame: Record<string, unknown>; message: string };
}> = {
  'request-id-short': { message: 'broker frame keys are invalid',
    reaches: { frame: { epochId, sequence: 0 }, message: 'requestId is invalid' } },
  'request-id-nonhex': { message: 'broker frame keys are invalid',
    reaches: { frame: { epochId, sequence: 0 }, message: 'requestId is invalid' } },
  'session-id-short': { message: 'broker frame keys are invalid',
    reaches: { frame: { epochId, sequence: 0 }, message: 'sessionId is invalid' } },
  'operation-key-short': { message: 'operationKey is invalid' },
  'epoch-id-short': { message: 'epochId is invalid' },
  'sequence-negative': { message: 'sequence is outside the safe integer range' },
  'sequence-overflow': { message: 'sequence is outside the safe integer range' },
  'missing-key': { message: 'broker frame keys are invalid' },
  'raw-authority-argv': { message: 'broker frame keys are invalid' },
  'raw-authority-env': { message: 'broker frame keys are invalid' },
  'raw-authority-user': { message: 'broker frame keys are invalid' },
  'raw-broker-frame-over-98304': { marker: 'rawBytes', message: 'declared broker frame exceeds 98,304 bytes' },
  // The decoder accepts this frame by design; LinuxBrokerServer enforces the in-flight bound.
  'queued-input-over-262144': { marker: 'queuedBytes', message: 'enforced by LinuxBrokerServer' },
  'decoded-input-over-65536': { marker: 'decodedBytes', message: 'decoded input exceeds 65,536 bytes',
    refusal: 'input-too-large' },
  'attachment-id-short': { owner: 'W4' },
  'cols-below-min': { owner: 'W4' },
  'cols-above-max': { owner: 'W4' },
  'rows-below-min': { owner: 'W4' },
  'rows-above-max': { owner: 'W4' },
  'cwd-over-240-bytes': { owner: 'W4' },
  'cwd-traversal': { owner: 'W4' },
  'invalid-base64': { owner: 'W4' },
  'raw-browser-frame-over-90112': { owner: 'W4' },
  'response-request-id-null': { owner: 'W4' },
  'unsolicited-request-id-non-null': { owner: 'W4' },
  'extra-key': { owner: 'W4' },
};

function refusalOf(call: () => unknown): BrokerProtocolError {
  let caught: unknown;
  try { call(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(BrokerProtocolError);
  return caught as BrokerProtocolError;
}

describe('brokerProtocol', () => {
  it('round-trips every shared broker frame through the strict length-prefixed wire', () => {
    for (const frame of validBrokerClientFrames) {
      expect(decodeBrokerClientFrame(frame)).toEqual(frame);
    }
    for (const frame of validBrokerServerFrames) {
      expect(decodeBrokerServerFrame(frame)).toEqual(frame);
    }

    const decoder = new BrokerFrameDecoder(decodeBrokerClientFrame);
    const wire = encodeBrokerFrame(validBrokerClientFrames[0]);
    expect(decoder.push(wire.subarray(0, 3))).toEqual([]);
    expect(decoder.push(wire.subarray(3))).toEqual([validBrokerClientFrames[0]]);
  });

  it('refuses every broker-frame invalid vector by the specific rule its case names', () => {
    expect(Object.keys(brokerVectorRules).sort())
      .toEqual(invalidPtyProtocolVectors.map((vector) => vector.case).sort());

    for (const vector of invalidPtyProtocolVectors) {
      const rule = brokerVectorRules[vector.case]!;
      if ('owner' in rule) continue; // browser-frame vector: W4's decoder owns its rule

      if (rule.marker === 'rawBytes') {
        expect(() => decodeBrokerClientFrame(vector.frame), vector.case).not.toThrow();
        const header = new Uint8Array(4);
        new DataView(header.buffer).setUint32(0, (vector as { rawBytes: number }).rawBytes);
        const error = refusalOf(() => new BrokerFrameDecoder(decodeBrokerClientFrame).push(header));
        expect(error.message, vector.case).toBe(rule.message);
        expect(error.refusal, vector.case).toBe('invalid-request');
        continue;
      }
      if (rule.marker === 'queuedBytes') {
        expect(() => decodeBrokerClientFrame(vector.frame), vector.case).not.toThrow();
        expect((vector as { queuedBytes: number }).queuedBytes, vector.case)
          .toBeGreaterThan(BROKER_MAX_QUEUED_INPUT_BYTES);
        continue;
      }
      if (rule.marker === 'decodedBytes') {
        // The vector's frame is a browser frame; its marker is the broker's own input bound,
        // so drive the named rule through a broker input frame carrying that many decoded bytes.
        const decodedBytes = (vector as { decodedBytes: number }).decodedBytes;
        expect(decodedBytes, vector.case).toBeGreaterThan(BROKER_MAX_INPUT_BYTES);
        const error = refusalOf(() => decodeBrokerClientFrame({
          ...validBrokerClientFrames[3], data: Buffer.alloc(decodedBytes).toString('base64'),
        }));
        expect(error.message, vector.case).toBe(rule.message);
        expect(error.refusal, vector.case).toBe(rule.refusal);
        continue;
      }

      const error = refusalOf(() => decodeBrokerClientFrame(vector.frame));
      expect(error.message, vector.case).toBe(rule.message);
      expect(error.refusal, vector.case).toBe(rule.refusal ?? 'invalid-request');
      if (rule.reaches !== undefined) {
        const repaired = refusalOf(() => decodeBrokerClientFrame({ ...vector.frame, ...rule.reaches!.frame }));
        expect(repaired.message, vector.case).toBe(rule.reaches.message);
        expect(repaired.refusal, vector.case).toBe('invalid-request');
      }
    }
  });

  it('rejects raw authority keys and non-canonical base64 on broker frames', () => {
    expect(() => decodeBrokerClientFrame({
      ...validBrokerClientFrames[0],
      argv: ['/bin/bash'],
    })).toThrow(BrokerProtocolError);
    expect(() => decodeBrokerClientFrame({
      type: 'input',
      requestId: 'req-00000000000000000000000000000000',
      sessionId: 'pty-00000000000000000000000000000000',
      epochId: 'epoch-00000000000000000000000000000000',
      sequence: 0,
      encoding: 'base64',
      data: 'YQ==\n',
    })).toThrow(BrokerProtocolError);
  });

  it('accepts a frame of exactly 98,304 bytes and refuses 98,305', () => {
    const overhead = Buffer.byteLength(JSON.stringify({ pad: '' }), 'utf8');
    const exact = { pad: 'x'.repeat(BROKER_MAX_FRAME_BYTES - overhead) };
    const body = Buffer.from(JSON.stringify(exact), 'utf8');
    expect(body.byteLength).toBe(BROKER_MAX_FRAME_BYTES);

    const wire = encodeBrokerFrame(exact);
    expect(wire.byteLength).toBe(BROKER_MAX_FRAME_BYTES + 4);
    expect(new BrokerFrameDecoder((value) => value).push(wire)).toEqual([exact]);

    const oversized = { pad: `${exact.pad}x` };
    expect(Buffer.byteLength(JSON.stringify(oversized), 'utf8')).toBe(BROKER_MAX_FRAME_BYTES + 1);
    expect(() => encodeBrokerFrame(oversized)).toThrow('exceeds 98,304 bytes');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(BROKER_MAX_FRAME_BYTES + 1, 0);
    expect(() => new BrokerFrameDecoder((value) => value).push(header)).toThrow('exceeds 98,304 bytes');
  });

  it('refuses a declared or buffered frame above 98,304 bytes before JSON parsing', () => {
    const oversizedHeader = new Uint8Array(4);
    new DataView(oversizedHeader.buffer).setUint32(0, BROKER_MAX_FRAME_BYTES + 1);
    const decoder = new BrokerFrameDecoder(decodeBrokerClientFrame);
    expect(() => decoder.push(oversizedHeader)).toThrow(BrokerProtocolError);

    expect(() => encodeBrokerFrame({ data: 'x'.repeat(BROKER_MAX_FRAME_BYTES) }))
      .toThrow(BrokerProtocolError);
  });
});
