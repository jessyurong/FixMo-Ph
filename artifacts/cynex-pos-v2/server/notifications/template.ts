/**
 * Email rendering.
 *
 * Customer-editable text is treated as plain text: it is escaped before being
 * inserted into the responsive HTML, and newlines become paragraphs/breaks.
 */

import type { EmailStatus, NotificationContent, RenderedNotification } from './types';

const STATUS_LABELS: Record<EmailStatus, string> = {
  received: 'Received',
  diagnosing: 'Diagnosing',
  waiting_parts: 'Waiting for parts',
  repairing: 'Repairing',
  ready: 'Ready for pickup',
  complete: 'Complete',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<EmailStatus, { background: string; color: string }> = {
  received: { background: '#fff4e5', color: '#b45309' },
  diagnosing: { background: '#eaf1ff', color: '#1d4ed8' },
  waiting_parts: { background: '#f3efff', color: '#6b46c1' },
  repairing: { background: '#e6f7fa', color: '#0e7490' },
  ready: { background: '#e8f7ee', color: '#117a3d' },
  complete: { background: '#e6f4ea', color: '#1a7f37' },
  cancelled: { background: '#f1f3f5', color: '#5c636a' },
};

export function statusLabel(status: EmailStatus): string {
  return STATUS_LABELS[status] || 'Updated';
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function messageToHtml(message: string): string {
  const paragraphs = String(message || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#30343b;">${escapeHtml(
          paragraph,
        ).replace(/\n/g, '<br/>')}</p>`,
    )
    .join('');
}

function messageToText(message: string): string {
  return String(message || '').replace(/\r\n?/g, '\n').trim();
}

function detailRow(label: string, value: string, last = false): string {
  return `<tr>
    <td style="padding:0 0 ${last ? '0' : '12px'};font-size:12px;line-height:1.4;color:#7a8088;text-transform:uppercase;letter-spacing:0.7px;vertical-align:top;width:38%;">${escapeHtml(
      label,
    )}</td>
    <td style="padding:0 0 ${last ? '0' : '12px'};font-size:15px;line-height:1.45;color:#20242a;font-weight:600;text-align:right;vertical-align:top;">${value}</td>
  </tr>`;
}

export function buildEmail(content: NotificationContent): RenderedNotification {
  const shopName = content.shopName;
  const label = statusLabel(content.status);
  const statusColor = STATUS_COLORS[content.status];
  const note = content.note?.trim();
  const trackingUrl = content.trackingUrl?.trim();
  const device = content.deviceLabel;
  const hasJobNumber = Boolean(content.jobNumber?.trim());

  const preheader = `${device} is now ${label} at ${shopName}.`;
  const noteHtml = note
    ? `<div style="margin:0 0 22px;padding:14px 16px;background:#fff7f3;border-left:3px solid #ff3c00;border-radius:8px;">
         <div style="margin:0 0 5px;font-size:11px;line-height:1.3;color:#b44412;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Note from the shop</div>
         <div style="font-size:15px;line-height:1.6;color:#3b2a22;">${escapeHtml(note).replace(/\n/g, '<br/>')}</div>
       </div>`
    : '';

  const trackingHtml = trackingUrl
    ? `<div style="margin:26px 0 8px;">
         <a href="${escapeHtml(
           trackingUrl,
         )}" target="_blank" rel="noopener" style="display:inline-block;background:#ff3c00;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 22px;border-radius:10px;">Track your device</a>
       </div>
       <div style="margin:10px 0 0;font-size:12px;line-height:1.5;color:#8a9098;word-break:break-all;">${escapeHtml(
         trackingUrl,
       )}</div>`
    : `<p style="margin:22px 0 0;font-size:14px;line-height:1.6;color:#5f6670;">Contact ${escapeHtml(
        shopName,
      )} if you have any questions about this update.</p>`;

  const testBanner = content.test
    ? `<div style="margin:0 0 20px;padding:11px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:13px;line-height:1.5;color:#9a3412;">
         <strong>Test email.</strong> This was sent from POS Settings. No customer received it.
       </div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f2f3f5;-webkit-text-size-adjust:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(
    preheader,
  )}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f3f5;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e8eb;">
          <tr>
            <td style="padding:24px 28px;background:#16181d;">
              <div style="font-size:12px;line-height:1.4;color:#ff8a5c;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">${escapeHtml(
                shopName,
              )}</div>
              <div style="margin-top:6px;font-size:24px;line-height:1.25;color:#ffffff;font-weight:700;">Repair update</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              ${testBanner}
              ${messageToHtml(content.message)}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px;padding:16px;background:#f7f8fa;border-radius:10px;">
                <tr><td style="padding:16px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    ${detailRow('Device', escapeHtml(device))}
                    ${detailRow(
                      'Status',
                      `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${statusColor.background};color:${statusColor.color};font-size:13px;line-height:1.4;font-weight:700;">${escapeHtml(
                        label,
                      )}</span>`,
                    )}
                    ${hasJobNumber ? detailRow('Job number', escapeHtml(content.jobNumber), true) : detailRow('Shop', escapeHtml(shopName), true)}
                  </table>
                </td></tr>
              </table>
              ${noteHtml}
              ${trackingHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 24px;background:#fafafa;border-top:1px solid #eceef1;">
              <div style="font-size:12px;line-height:1.6;color:#8a9098;">You are receiving this email because an email address was provided for a repair at ${escapeHtml(
                shopName,
              )}. This message does not include prices or payment details.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textLines = [
    shopName,
    'REPAIR UPDATE',
    '',
    messageToText(content.message),
    '',
    `Device: ${device}`,
    `Status: ${label}`,
    ...(hasJobNumber ? [`Job number: ${content.jobNumber}`] : []),
    ...(note ? ['', `Note from the shop: ${note}`] : []),
    ...(trackingUrl ? ['', `Track your device: ${trackingUrl}`] : []),
    '',
    `You are receiving this email because an email address was provided for a repair at ${shopName}.`,
  ];

  return {
    to: content.to,
    subject: content.subject,
    html,
    text: textLines.join('\n'),
    idempotencyKey: `cynex-status/${content.eventId}`.slice(0, 256),
  };
}
