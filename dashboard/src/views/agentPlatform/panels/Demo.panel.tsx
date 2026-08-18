/**
 * DEMO panel — the reference registration, and the proof that the mechanism works.
 *
 * This file was added WITHOUT touching `registry.ts`, `AgentPlatform.tsx`, `nav/config.ts`,
 * `App.tsx` or `styles/views/agentPlatform.css`: dropping ONE `*.panel.tsx` entry file into
 * `panels/` (plus its OWN stylesheet) is the entire registration. Copy its shape for a real panel.
 *
 * DO NOT DELETE THIS FILE CASUALLY — it is load-bearing for the U0 tests that pin the registration
 * mechanism: `agentPlatform/registry.test.ts` (discovers the demo panel by id), `AgentPlatform.test.tsx`
 * (asserts its tile title/description and its opened body) and `App.test.tsx` (asserts the tile is
 * reachable from the nav destination). Removing it reds all three. Retiring the demo once real panels
 * exist is a U12/integration decision — it must land together with the test updates that replace these
 * assertions with a real panel's.
 */
import type { AgentPlatformPanel } from '../types';
import '../../../styles/views/agentPlatformDemo.css';

function DemoBody(): React.JSX.Element {
  return (
    <div className="ap-demo">
      <p className="ap-demo__line">
        This placeholder panel registered itself by existing at
        <code className="ap-demo__path"> src/views/agentPlatform/panels/Demo.panel.tsx</code>.
      </p>
      <p className="ap-demo__line ap-demo__line--faint">
        Add a sibling <code className="ap-demo__path">*.panel.tsx</code> exporting{' '}
        <code className="ap-demo__path">panel</code> and it appears here too — no shared file is edited.
      </p>
    </div>
  );
}

export const panel: AgentPlatformPanel = {
  id: 'demo-placeholder',
  title: 'Demo Panel',
  description: 'Placeholder proving a panel registers by file drop alone.',
  render: () => <DemoBody />,
};
