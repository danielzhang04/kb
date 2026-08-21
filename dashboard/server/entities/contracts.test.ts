import { describe, expectTypeOf, it } from 'vitest';
import type { CreateEntityRequest, EntityBrief, EntityBuilderRequest, EntityDetail, EntityDetails, EntityList, EntitySummary, RunnableSelector } from './contracts.ts';

describe('P2 entity contracts', () => {
  it('distinguishes untrusted selectors from trusted runnable summaries', () => {
    expectTypeOf<RunnableSelector>().toEqualTypeOf<{ type: 'agent' | 'workflow'; id: string }>();
    // @ts-expect-error A client selector never supplies declaration provenance.
    const selector: RunnableSelector = { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' };
    void selector;
    expectTypeOf<EntitySummary>().toMatchTypeOf<{ ref: { sourcePath: string }; activeRuns: unknown[] }>();
  });

  it('keeps entity list/detail envelopes revisioned and closed', () => {
    expectTypeOf<EntityList>().toMatchTypeOf<{ revision: string; groups: unknown[]; items: EntitySummary[] }>();
    expectTypeOf<EntityDetail>().toEqualTypeOf<{ revision: string; summary: EntitySummary; brief: EntityBrief; details: EntityDetails }>();
  });

  it('keeps builder display-policy fields and workflow project declaration explicit', () => {
    expectTypeOf<EntityBuilderRequest>().toEqualTypeOf<{
      humanName: string;
      purpose: string;
      model: string;
      profile: string;
      tools: string[];
      skills: string[];
      connectors: string[];
      filesystemRoots: string[];
    }>();
    expectTypeOf<CreateEntityRequest>().toMatchTypeOf<EntityBuilderRequest & {
      selector: RunnableSelector;
      project?: string;
      expectedCollectionRevision: string;
      idempotencyKey: string;
    }>();
  });
});
