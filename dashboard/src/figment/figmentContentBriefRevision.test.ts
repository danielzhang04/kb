import { describe, expect, it } from 'vitest';
import { decodeFigmentContentBriefRevisionResult } from '../../shared/figmentContentBriefRevision';

const ID = '2026-09-12-creator-001-revision-a';
const HASH = 'a'.repeat(64);

function result(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'figment/studio-content-brief-revision@1',
    status: 'published',
    briefId: ID,
    briefSha256: HASH,
    ...overrides,
  };
}

describe('content brief revision success decoder', () => {
  it('projects only the exact public success DTO for the locally expected derived ID', () => {
    expect(decodeFigmentContentBriefRevisionResult(result(), ID)).toEqual({
      schema: 'figment/studio-content-brief-revision@1',
      status: 'published',
      briefId: ID,
      briefSha256: HASH,
    });
  });

  it('accepts the inclusive 128 UTF-16 unit ID bound', () => {
    const briefId = 'a'.repeat(128);
    expect(decodeFigmentContentBriefRevisionResult(result({ briefId }), briefId)).toEqual({
      schema: 'figment/studio-content-brief-revision@1',
      status: 'published',
      briefId,
      briefSha256: HASH,
    });
  });

  it.each([
    ['unsafe id', '../escape'],
    ['uppercase id', '2026-09-12-CREATOR-001-revision-a'],
    ['overlong id', 'a'.repeat(129)],
  ])('checks ID grammar independently when %s also matches the expected ID', (_name, briefId) => {
    expect(decodeFigmentContentBriefRevisionResult(result({ briefId }), briefId)).toBeNull();
  });

  it.each([
    ['non-object', null],
    ['array', []],
    ['null-prototype record', Object.assign(Object.create(null), result())],
    ['inherited record', Object.assign(Object.create({ inherited: true }), result())],
    ['missing hash', { schema: 'figment/studio-content-brief-revision@1', status: 'published', briefId: ID }],
    ['extra private field', result({ recoveryPath: 'PRIVATE_RECOVERY_PATH' })],
    ['wrong schema', result({ schema: 'figment/other@1' })],
    ['wrong status', result({ status: 'pending' })],
    ['wrong derived id', result({ briefId: '2026-09-12-creator-001-other' })],
    ['uppercase hash', result({ briefSha256: 'A'.repeat(64) })],
    ['short hash', result({ briefSha256: 'a'.repeat(63) })],
  ])('rejects %s', (_name, value) => {
    expect(decodeFigmentContentBriefRevisionResult(value, ID)).toBeNull();
  });
});
