/**
 * Resend email provider.
 *
 * The API key is read from the server environment only. It is never returned to
 * the browser, written to logs, or included in the POS bundle.
 */

import {
  NotificationError,
  type NotificationProvider,
  type NotificationProviderResult,
  type RenderedNotification,
} from '../types';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 15_000;

function env(name: string): string {
  return String(process.env[name] || '').trim();
}

export function isResendConfigured(): boolean {
  return Boolean(env('RESEND_API_KEY') && (env('RESEND_FROM_EMAIL') || env('NOTIFY_FROM_EMAIL')));
}

function safeProviderMessage(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 400);
  return 'Resend rejected the email';
}

export class ResendProvider implements NotificationProvider {
  readonly id = 'resend';
  readonly channel = 'email' as const;

  isConfigured(): boolean {
    return isResendConfigured();
  }

  async send(notification: RenderedNotification): Promise<NotificationProviderResult> {
    const apiKey = env('RESEND_API_KEY');
    const from = env('RESEND_FROM_EMAIL') || env('NOTIFY_FROM_EMAIL');
    const replyTo = env('RESEND_REPLY_TO');

    if (!apiKey || !from) {
      throw new NotificationError(
        'Resend is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL in Vercel.',
        503,
        false,
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': notification.idempotencyKey,
        },
        body: JSON.stringify({
          from,
          to: [notification.to],
          subject: notification.subject,
          html: notification.html,
          text: notification.text,
          ...(replyTo ? { reply_to: replyTo } : {}),
        }),
        signal: controller.signal,
      });

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (!response.ok) {
        const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
        const message = safeProviderMessage(record.message || record.error);
        const retryable =
          response.status === 409 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500;
        throw new NotificationError(message, response.status, retryable);
      }

      const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      return { id: typeof record.id === 'string' ? record.id : undefined };
    } catch (error) {
      if (error instanceof NotificationError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new NotificationError('Resend request timed out', 0, true);
      }
      throw new NotificationError(
        error instanceof Error ? error.message : 'Could not reach Resend',
        0,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
