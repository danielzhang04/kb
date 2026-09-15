/**
 * The eight-stage Figment pipeline, mirroring `STAGES` in
 * `orgs/figment/pipeline/figment_train.py` (`anchor, dataset, smoke, train, tester, gen,
 * detail, video`, in the CLI's own stage-execution order). This is the ONE server-side
 * declaration of that list (E2 — Studio previously hardcoded the two stage names it uses,
 * `studioGenPlan.ts` its own `STAGE = 'gen'`, `planPreview.ts` its own `STAGE = 'tester'`,
 * with no shared source and no check that either string was still a real CLI stage).
 * `figmentStages.integration.test.ts` asserts this tuple equals the live Python constant,
 * read via `FIGMENT_TEST_PYTHON_EXECUTABLE`, so the two lists cannot drift silently again.
 */
export const FIGMENT_STAGES = [
  'anchor', 'dataset', 'smoke', 'train', 'tester', 'gen', 'detail', 'video',
] as const;

export type FigmentStage = typeof FIGMENT_STAGES[number];
