import { describe, expectTypeOf, it } from 'vitest';
import type { HomeResponse, HomeSections } from './contracts.ts';

describe('P2 Home contracts', () => {
  it('pins D13 section order in the response tuple', () => {
    expectTypeOf<HomeSections>().toEqualTypeOf<readonly [
      import('./contracts.ts').RunningNowSectionResult,
      import('./contracts.ts').AttentionCountsSectionResult,
      import('./contracts.ts').NextSchedulesSectionResult,
      import('./contracts.ts').VersionSectionResult,
      import('./contracts.ts').RecentOutcomesSectionResult,
    ]>();
    expectTypeOf<HomeResponse>().toMatchTypeOf<{ revision: string; sections: HomeSections }>();
  });
});
