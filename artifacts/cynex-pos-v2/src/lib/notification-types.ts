/**
 * Customer notification types and settings.
 *
 * Notifications are intentionally decoupled from the tracking mirror. The POS
 * keeps a durable outbox in IndexedDB (one row per ticket + status) so an email
 * can be queued while offline, retried later, and never sent twice for the same
 * status.
 */

import {
  normalizeTransactionStatus,
  TRANSACTION_STATUSES,
  type TransactionStatus,
} from './db-types';

/** Channels are extensible. SMS can be added without changing the queue. */
export type NotificationChannel = 'email';

export type NotificationOutboxState = 'pending' | 'sent' | 'failed';

export const EMAIL_SUBJECT_MAX_LENGTH = 140;
export const EMAIL_MESSAGE_MAX_LENGTH = 2000;
export const NOTIFICATION_NOTE_MAX_LENGTH = 240;

/** Every customer-visible status, including the terminal cancelled state. */
export const EMAIL_NOTIFICATION_STATUSES = [...TRANSACTION_STATUSES, 'cancelled'] as const;

export const DEFAULT_EMAIL_NOTIFY_STATUSES: TransactionStatus[] = ['ready', 'complete'];

export const DEFAULT_EMAIL_SUBJECT_TEMPLATE = 'Update on your {{device}} repair';

export const DEFAULT_EMAIL_MESSAGE_TEMPLATE = [
  'Hi {{customer_first_name}},',
  '',
  'Your {{device}} is now {{status_label}} at {{shop_name}}.',
  '',
  'Thank you,',
  '{{shop_name}}',
].join('\n');

/**
 * Placeholders are rendered in the POS before an email is queued, then the
 * server safely escapes the final text and wraps it in responsive HTML.
 */
export const NOTIFICATION_TEMPLATE_PLACEHOLDERS = [
  '{{customer_first_name}}',
  '{{shop_name}}',
  '{{device}}',
  '{{status}}',
  '{{status_label}}',
  '{{note}}',
  '{{job_number}}',
  '{{tracking_url}}',
] as const;

const STATUS_LABELS: Record<TransactionStatus, string> = {
  received: 'Received',
  diagnosing: 'Diagnosing',
  waiting_parts: 'Waiting for parts',
  repairing: 'Repairing',
  ready: 'Ready for pickup',
  complete: 'Complete',
  cancelled: 'Cancelled',
};

export function notificationStatusLabel(status: unknown): string {
  const normalized = normalizeTransactionStatus(status);
  return STATUS_LABELS[normalized] || 'Updated';
}

export interface EmailNotificationSettings {
  enabled: boolean;
  statuses: TransactionStatus[];
  subjectTemplate: string;
  messageTemplate: string;
}

/** Read settings from the existing key/value `settings` table with defaults. */
export function readEmailNotificationSettings(
  raw: Record<string, any> | null | undefined,
): EmailNotificationSettings {
  const settings = raw || {};

  const enabled =
    typeof settings.emailNotificationsEnabled === 'boolean'
      ? settings.emailNotificationsEnabled
      : true;

  let statuses: TransactionStatus[];
  if (Array.isArray(settings.emailNotifyStatuses)) {
    const seen = new Set<TransactionStatus>();
    for (const value of settings.emailNotifyStatuses) {
      const normalized = normalizeTransactionStatus(value);
      if ((EMAIL_NOTIFICATION_STATUSES as readonly string[]).includes(normalized)) {
        seen.add(normalized);
      }
    }
    statuses = [...seen];
  } else {
    statuses = [...DEFAULT_EMAIL_NOTIFY_STATUSES];
  }

  const subjectTemplate =
    typeof settings.emailSubjectTemplate === 'string' && settings.emailSubjectTemplate.trim()
      ? settings.emailSubjectTemplate.trim().slice(0, EMAIL_SUBJECT_MAX_LENGTH)
      : DEFAULT_EMAIL_SUBJECT_TEMPLATE;

  const messageTemplate =
    typeof settings.emailMessageTemplate === 'string' && settings.emailMessageTemplate.trim()
      ? settings.emailMessageTemplate.trim().slice(0, EMAIL_MESSAGE_MAX_LENGTH)
      : DEFAULT_EMAIL_MESSAGE_TEMPLATE;

  return { enabled, statuses, subjectTemplate, messageTemplate };
}

/**
 * Replace `{{placeholders}}` case-insensitively. Unknown placeholders are left
 * untouched so a typo is visible in the preview instead of silently vanishing.
 */
export function renderNotificationTemplate(
  template: string,
  variables: Record<string, string | undefined>,
): string {
  return String(template || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, key: string) => {
    const value = variables[key.toLowerCase()];
    return typeof value === 'string' ? value : match;
  });
}

/** Basic, deliberately permissive email validation shared by UI + queue. */
export function isValidEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  return email.length >= 5 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** One durable queue row per ticket + status. */
export interface NotificationOutboxEntry {
  dedupeKey: string;
  transactionId: number;
  token: string;
  channel: NotificationChannel;
  provider: string;
  to: string;
  subject: string;
  message: string;
  shopName: string;
  deviceLabel: string;
  status: TransactionStatus;
  note?: string;
  trackingUrl?: string;
  jobNumber?: string;
  state: NotificationOutboxState;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  nextAttemptAt?: string;
}

/** POST body accepted by `/api/notify`. */
export interface EmailNotificationRequest {
  channel: 'email';
  eventId: string;
  to: string;
  subject: string;
  message: string;
  shopName: string;
  deviceLabel: string;
  status: TransactionStatus;
  note?: string;
  trackingUrl?: string;
  jobNumber?: string;
  test?: boolean;
}

export interface NotificationHealth {
  reachable: boolean;
  configured: boolean;
  provider?: string;
  error?: string;
}
