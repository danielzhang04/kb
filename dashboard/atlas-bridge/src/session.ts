import { z } from 'zod';
import type { DashboardClient } from './client.js';

export const AtlasSessionNotificationSchema = z.object({
  method: z.literal('notifications/atlas/session'),
  params: z.object({ token: z.string(), expiresAt: z.union([z.string(), z.number()]) }).strict(),
});

export function applyAtlasSessionNotification(client: DashboardClient, value: unknown): void {
  const notification = AtlasSessionNotificationSchema.parse(value);
  client.setSession(notification.params);
}
