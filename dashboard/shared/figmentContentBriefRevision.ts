export interface FigmentContentBriefRevisionResult {
  readonly schema: 'figment/studio-content-brief-revision@1';
  readonly status: 'published';
  readonly briefId: string;
  readonly briefSha256: string;
}

const RESULT_KEYS = ['briefId', 'briefSha256', 'schema', 'status'];
const BRIEF_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
};

const isBriefId = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= 128 && BRIEF_ID.test(value);

export function decodeFigmentContentBriefRevisionResult(
  value: unknown,
  expectedBriefId: string,
): FigmentContentBriefRevisionResult | null {
  if (!isObject(value) || !hasExactKeys(value, RESULT_KEYS)) return null;
  if (value.schema !== 'figment/studio-content-brief-revision@1' || value.status !== 'published') return null;
  if (!isBriefId(value.briefId) || value.briefId !== expectedBriefId) return null;
  if (typeof value.briefSha256 !== 'string' || !SHA256.test(value.briefSha256)) return null;
  return {
    schema: 'figment/studio-content-brief-revision@1',
    status: 'published',
    briefId: value.briefId,
    briefSha256: value.briefSha256,
  };
}
