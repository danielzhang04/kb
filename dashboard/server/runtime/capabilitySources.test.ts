import { describe, expect, it } from 'vitest';
import { runtimeHostCapabilities } from './capabilities.ts';
import { probeAdvertisementCapabilities, withAdvertisementCapabilities } from './capabilitySources.ts';

describe('probeAdvertisementCapabilities — a failed probe defaults CLOSED [P6-C15]', () => {
  it('defaults every field closed when no probes are supplied', async () => {
    expect(await probeAdvertisementCapabilities()).toEqual({
      connectors: [], skills: [], filesystemRoots: [], gpu: false,
      clis: { claude: 'missing', codex: 'missing' },
    });
  });

  it('defaults every field closed when every probe throws, never rejecting the whole composition', async () => {
    const throwing = async (): Promise<never> => { throw new Error('probe exploded'); };
    await expect(probeAdvertisementCapabilities({
      probeConnectors: throwing, probeSkills: throwing, probeFilesystemRoots: throwing,
      probeGpu: throwing, probeClis: throwing,
    })).resolves.toEqual({
      connectors: [], skills: [], filesystemRoots: [], gpu: false,
      clis: { claude: 'missing', codex: 'missing' },
    });
  });

  it('carries a successful probe result through untouched', async () => {
    expect(await probeAdvertisementCapabilities({
      probeConnectors: async () => [{ server: 'gmail', tools: ['read'] }],
      probeSkills: async () => ['docx'],
      probeFilesystemRoots: async () => ['ops'],
      probeGpu: async () => true,
      probeClis: async () => ({ claude: 'ready', codex: 'missing' }),
    })).toEqual({
      connectors: [{ server: 'gmail', tools: ['read'] }],
      skills: ['docx'],
      filesystemRoots: ['ops'],
      gpu: true,
      clis: { claude: 'ready', codex: 'missing' },
    });
  });

  it('one throwing probe does not poison the others — each field defaults independently', async () => {
    expect(await probeAdvertisementCapabilities({
      probeConnectors: async () => { throw new Error('boom'); },
      probeSkills: async () => ['docx'],
    })).toEqual({
      connectors: [], skills: ['docx'], filesystemRoots: [], gpu: false,
      clis: { claude: 'missing', codex: 'missing' },
    });
  });
});

describe('withAdvertisementCapabilities — overlays onto the SAME composed RuntimeHostCapabilities [P6-C15]', () => {
  it('leaves the non-advertisement fields of the base capability untouched', async () => {
    const base = runtimeHostCapabilities('linux');
    const composed = await withAdvertisementCapabilities(base, { probeGpu: async () => true });
    expect(composed).toMatchObject({
      platform: 'linux', python: base.python, runnerTrigger: false, vibe: false,
      durablePrWrites: false, localTranscripts: false, dashboardBridge: true,
    });
    expect(composed.gpu).toBe(true);
  });

  it('is byte-identical to the closed base when no probes are supplied — there is no second composition', async () => {
    const base = runtimeHostCapabilities('win32');
    expect(await withAdvertisementCapabilities(base)).toEqual(base);
  });
});
