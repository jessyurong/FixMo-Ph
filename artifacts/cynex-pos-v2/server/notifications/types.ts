/**
 * Shared server-side notification types.
 *
 * This file is bundled only into the Vercel function (never the browser).
 */

export const NOTIFICATION_CHANNELS = ['email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const EMAIL_STATUSES = [
  'received',
  'diagnosing',
  'waiting_parts',
  'repairing',
  'ready',
  'complete',
  'cancelled',
] as const;

export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export interface NotificationContent {
  eventId: string;
  to: string;
  subject: string;
  message: string;
  shopName: string;
  deviceLabel: string;
  status: EmailStatus;
  note?: string;
  trackingUrl?: string;
  jobNumber?: string;
  test?: boolean;
}

export interface RenderedNotification {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

export interface NotificationProviderResult {
  id?: string;
}

/**
 * A provider is responsible for one delivery channel. Adding SMS later means
 * adding another implementation and registering it in `providers/index.ts`;
 * the queue, API validation, and settings do not need a new transport.
 */
export interface NotificationProvider {
  readonly id: string;
  readonly channel: NotificationChannel;
  isConfigured(): boolean;
  send(notification: RenderedNotification): Promise<NotificationProviderResult>;
}

export class NotificationError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status = 0, retryable = false) {
    super(message);
    this.name = 'NotificationError';
    this.status = status;
    this.retryable = retryable;
  }
}
