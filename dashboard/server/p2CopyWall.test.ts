import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('P2 preserves P7-owned banner, Health, and escalation copy byte-for-byte', () => {
  const root = resolve(import.meta.dirname, '..');
  const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');
  const health = readFileSync(resolve(root, 'src/views/Health.tsx'), 'utf8');
  const healthService = readFileSync(resolve(root, 'server/health/service.ts'), 'utf8');
  const inbox = readFileSync(resolve(root, 'server/inbox/project.ts'), 'utf8');

  expect(app).toContain('<h1 className="mc-topbar__title">kb mission control</h1>');
  expect(app).toContain('aria-hidden="true" />local agent operations</span>');
  expect(health).toContain("error ? 'Health is unavailable.' : 'Loading health.'");
  expect(healthService).toContain("label: 'Unavailable'");
  expect(healthService).toContain("reason: 'Reader unavailable'");
  expect(healthService).toContain("const deferredValue = 'unavailable in P1' as const;");
  expect(inbox).toContain('title: text(card.meta.action),\r\n    reason: workOrder(card),');
  expect(inbox).toContain('Project only queued wake-me cards, the persisted escalation record for failed runs and STOP events.');
});
