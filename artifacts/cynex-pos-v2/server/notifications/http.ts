/**
 * HTTP entry point for `/api/notify`.
 *
 * Kept outside the Vite bundle and independent of the browser. It validates
 * input, checks the optional shared secret, then delegates delivery to the
 * registered channel provider.
 */

import { buildEmail } from './template';
import { notificationServiceHealth, providerForChannel } from './providers';
import {
  EMAIL_STATUSES,
  NotificationError,
  type EmailStatus,
  type NotificationContent,
  type NotificationProvider,
} from './types';

const MAX_BODY_BYTES = 32_768;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,220}$/;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function serverSecret(): string {
  return String(process.env.NOTIFY_API_SECRET || '').trim();
}

function isAuthorized(request: Request): boolean {
  const expected = serverSecret();
  if (!expected) return true;
  return request.headers.get('x-notify-secret') === expected;
}

function singleLine(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function multiline(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
}

function normalizeUrl(value: unknown): string | undefined {
  const raw = singleLine(value, 2048);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseBody(body: unknown): { content?: NotificationContent; error?: string } {
  if (!body || typeof body !== 'object') return { error: 'Request body must be a JSON object' };
  const record = body as Record<string, unknown>;

  const channel = singleLine(record.channel || 'email', 20);
  if (channel !== 'email') return { error: `Unsupported notification channel: ${channel}` };

  const eventId = singleLine(record.eventId, 220);
  if (!EVENT_ID_PATTERN.test(eventId)) {
    return { error: 'eventId must be 1-220 URL-safe characters' };
  }

  const to = singleLine(record.to, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(to)) return { error: 'Enter a valid recipient email address' };

  const subject = singleLine(record.subject, 200);
  if (!subject) return { error: 'Email subject is required' };

  const message = multiline(record.message, 4000);
  if (!message) return { error: 'Email message is required' };

  const shopName = singleLine(record.shopName, 120);
  if (!shopName) return { error: 'Shop name is required' };

  const deviceLabel = singleLine(record.deviceLabel, 80);
  if (!deviceLabel) return { error: 'Device label is required' };

  const rawStatus = singleLine(record.status, 30).toLowerCase();
  if (!(EMAIL_STATUSES as readonly string[]).includes(rawStatus)) {
    return { error: 'Unknown repair status' };
  }

  const note = multiline(record.note, 500) || undefined;
  const rawTrackingUrl = singleLine(record.trackingUrl, 2048);
  const trackingUrl = normalizeUrl(rawTrackingUrl);
  if (rawTrackingUrl && !trackingUrl) {
    return { error: 'trackingUrl must be a valid http(s) URL' };
  }
  if (!trackingUrl && record.test !== true) {
    return { error: 'trackingUrl is required for customer updates' };
  }
  const jobNumber = singleLine(record.jobNumber, 80) || undefined;

  return {
    content: {
      eventId,
      to,
      subject,
      message,
      shopName,
      deviceLabel,
      status: rawStatus as EmailStatus,
      ...(note ? { note } : {}),
      ...(trackingUrl ? { trackingUrl } : {}),
      ...(jobNumber ? { jobNumber } : {}),
      test: record.test === true,
    },
  };
}

export async function handleNotifyRequest(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return json({ ok: false, error: 'Unauthorized notification request' }, 401);
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    const health = notificationServiceHealth();
    return json({
      ok: true,
      configured: health.configured,
      provider: health.provider,
      channels: health.channels,
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Allow: 'GET, POST',
        'Cache-Control': 'no-store',
      },
    });
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return json({ ok: false, error: 'Content-Type must be application/json' }, 415);
  }

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Request body is too large' }, 413);
  }

  let parsedBody: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ ok: false, error: 'Request body is too large' }, 413);
    }
    parsedBody = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: 'Invalid JSON request body' }, 400);
  }

  const parsed = parseBody(parsedBody);
  if (parsed.error || !parsed.content) {
    return json({ ok: false, error: parsed.error || 'Invalid notification request' }, 400);
  }

  let provider: NotificationProvider;
  try {
    provider = providerForChannel('email');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unsupported channel';
    return json({ ok: false, error: message }, 400);
  }

  if (!provider.isConfigured()) {
    return json(
      {
        ok: false,
        error:
          'Email service is not configured on the server. Add RESEND_API_KEY and RESEND_FROM_EMAIL in Vercel.',
      },
      503,
    );
  }

  try {
    const rendered = buildEmail(parsed.content);
    const result = await provider.send(rendered);
    return json({
      ok: true,
      id: result.id,
      provider: provider.id,
      channel: provider.channel,
    });
  } catch (error) {
    if (error instanceof NotificationError) {
      const status = error.status === 429 ? 429 : error.status === 503 ? 503 : 502;
      console.error('[notify] provider rejected email:', {
        provider: provider.id,
        status: error.status,
        retryable: error.retryable,
        message: error.message,
      });
      return json(
        {
          ok: false,
          error: error.message,
          retryable: error.retryable,
        },
        status,
      );
    }

    console.error('[notify] unexpected send failure:', error);
    return json({ ok: false, error: 'Could not send the email', retryable: true }, 500);
  }
}
