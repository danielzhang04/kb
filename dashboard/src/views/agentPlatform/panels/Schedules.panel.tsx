import type { AgentPlatformPanel } from '../types';
import { SchedulesBody, replaceCadenceSchedule } from '../../Schedules';

export { SchedulesBody, replaceCadenceSchedule };

export const panel: AgentPlatformPanel = {
  id: 'schedules', order: 6, title: 'Schedules',
  description: 'Declared HEARTBEAT cadences, recent outcomes, and governed schedule proposals.',
  placement: 'sidebar', render: () => <SchedulesBody />,
};
