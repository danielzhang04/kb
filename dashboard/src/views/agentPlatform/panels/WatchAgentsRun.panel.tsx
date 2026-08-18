/**
 * Watch agents run (Agent Platform, Wave-1 U15) — the registration entry file.
 *
 * One entry file, its OWN stylesheet, and the body in a sibling directory the registry glob
 * (`./panels/*.panel.tsx`) deliberately does not see. No shared file is edited to register it.
 *
 * The panel itself is documented in `watchAgentsRun/WatchAgentsRunBody.tsx`.
 */
import type { AgentPlatformPanel } from '../types';
import { WatchAgentsRunBody } from './watchAgentsRun/WatchAgentsRunBody';
import '../../../styles/views/agentPlatformWatchAgentsRun.css';

export const panel: AgentPlatformPanel = {
  id: 'watch-agents-run',
  order: 30,
  title: 'Watch agents run',
  description: 'Live runs, agent by agent: state, model, time working, tools called, latest output.',
  render: () => <WatchAgentsRunBody />,
};
