import { describe, expect, it } from 'vitest';
import { ALL_COMMANDS, NAVIGATE_COMMANDS, filterCommands } from './paletteModel';

describe('P1 palette inventory', () => {
  it('is exactly the ten P1 destination commands', () => {
    expect(ALL_COMMANDS.map((command) => command.id)).toEqual([
      'nav:home', 'nav:inbox', 'nav:schedules', 'nav:terminal', 'nav:agents',
      'nav:workflows', 'nav:tasks', 'nav:projects', 'nav:files', 'nav:health',
    ]);
    expect(NAVIGATE_COMMANDS).toHaveLength(10);
    expect(ALL_COMMANDS.every((command) => command.kind === 'navigate' && !command.disabled)).toBe(true);
  });

  it('filters destinations by label and keywords', () => {
    expect(filterCommands(ALL_COMMANDS, '')).toHaveLength(10);
    expect(filterCommands(ALL_COMMANDS, 'workflows').map((command) => command.target)).toContain('workflows');
    expect(filterCommands(ALL_COMMANDS, 'zzzzq')).toEqual([]);
  });
});
