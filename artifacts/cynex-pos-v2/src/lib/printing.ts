import * as QRCode from "qrcode";
import type { ShopProfile } from "./shop-profile";
import { formatCurrency } from "./utils";
import { isSupabaseConfigured, trackingPageUrl } from "./tracking-config";

/**
 * Printing support for receipts and job slips.
 *
 * Uses the local browser print dialog (no external PDF service): a popup
 * window is opened, the receipt/slip is rendered as a self-contained HTML
 * document, and the browser's print dialog is triggered automatically. The
 * shop identity comes from the existing Shop Profile (settings table) so any
 * logo, name, address, contact, and email the user configured is honored.
 */

export function escHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c];
  });
}

export function formatDateForPrint(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

const STATUS_LABEL: Record<string, string> = {
  received: "RECEIVED",
  diagnosing: "DIAGNOSING",
  waiting_parts: "WAITING FOR PARTS",
  repairing: "REPAIRING",
  ready: "READY",
  complete: "COMPLETE",
  cancelled: "CANCELLED",
  // Legacy labels kept so old printed records still render sensibly.
  pending: "RECEIVED",
  in_progress: "REPAIRING",
  waiting_for_parts: "WAITING FOR PARTS",
  pre_ordered: "WAITING FOR PARTS",
  ready_for_pickup: "READY",
  completed: "COMPLETE",
};

function statusLabel(status?: string): string {
  const key = String(status || "").trim().replace(/-/g, "_").toLowerCase();
  return STATUS_LABEL[key] || String(status || "").toUpperCase() || "JOB";
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Structural source accepted by the print helpers (keeps printing.ts decoupled). */
export interface PrintSource {
  jobNumber?: string;
  status?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  /** Public tracking token (printed as a QR on completed receipts). */
  trackingToken?: string;
  phoneBrand?: string;
  phoneModel?: string;
  /** Device lock passcode — printed on job slips only, never on receipts. */
  devicePasscode?: string;
  technicianName?: string;
  createdAt?: string;
  completedAt?: string;
  items?: Array<{
    type?: string;
    name?: string;
    quantity?: number;
    price?: number;
    isPreOrder?: boolean;
    isCustom?: boolean;
  }>;
  subtotal?: number;
  discount?: number;
  total?: number;
  amountPaid?: number;
  remainingBalance?: number;
  paymentMethod?: string;
  paymentStatus?: string;
  cashReceived?: number;
  change?: number;
  hasPreOrder?: boolean;
}

function paymentStatusLabel(
  paymentStatus?: string,
  total?: number,
  amountPaid?: number,
): string {
  if (paymentStatus === "paid") return "PAID";
  if (paymentStatus === "partial") return "PARTIAL PAYMENT";
  if (paymentStatus === "unpaid") return "UNPAID";
  const t = Number(total || 0);
  const paid = Number(amountPaid || 0);
  if (t > 0 && paid >= t) return "PAID";
  if (paid > 0) return "PARTIAL PAYMENT";
  return "UNPAID";
}

interface TrackingQr {
  dataUrl: string;
  url: string;
}

function buildPrintHtml(
  shop: ShopProfile,
  settings: Record<string, any> | null | undefined,
  kind: "receipt" | "slip",
  source: PrintSource,
  trackingQr?: TrackingQr,
): string {
  const items = source.items || [];
  const subtotal = round2(
    items.reduce((sum, it) => sum + Math.max(0, Number(it.price || 0)) * Math.max(0, Number(it.quantity || 1)), 0),
  );
  const discount = Math.max(0, Number(source.discount || 0));
  const total = Number(source.total ?? (subtotal - discount));
  const amountPaid = Number(source.amountPaid || 0);
  const remainingBalance = Number(source.remainingBalance ?? Math.max(0, round2(total - amountPaid)));
  const paymentStatus = paymentStatusLabel(source.paymentStatus, total, amountPaid);

  const docTitle = kind === "receipt" ? "OFFICIAL RECEIPT" : "JOB SLIP";
  const hasPreOrder = source.hasPreOrder === true || items.some((it) => it.isPreOrder);

  const brandName = escHtml(shop.name);
  const contactLines = [
    shop.address,
    shop.contactNumber ? `Tel: ${shop.contactNumber}` : undefined,
    shop.email ? `Email: ${shop.email}` : undefined,
  ]
    .filter(Boolean)
    .map((v) => escHtml(v))
    .join("<br/>");

  const logoHtml = shop.logo
    ? `<img src="${shop.logo}" alt="${brandName}" style="width:auto;height:72px;max-width:160px;object-fit:contain;margin-bottom:6px;"/>`
    : "";

  const itemRows = items
    .map((it, index) => {
      const name = escHtml(it.name || `Item ${index + 1}`);
      const qty = Math.max(0, Number(it.quantity || 1));
      const price = Math.max(0, Number(it.price || 0));
      const flags = [
        it.isPreOrder ? "PRE-ORDER" : "",
        it.isCustom ? "CUSTOM" : "",
      ].filter(Boolean).join(" ");
      const nameCell = `${name}${flags ? ` <span class="tag">${escHtml(flags)}</span>` : ""}`;
      return `
        <tr>
          <td>${nameCell}</td>
          <td align="center">${qty}</td>
          <td align="right">${formatCurrency(price)}</td>
          <td align="right">${formatCurrency(round2(price * qty))}</td>
        </tr>`;
    })
    .join("");

  const methodLine = source.paymentMethod
    ? `<div class="kv"><span>Payment method</span><span>${escHtml(source.paymentMethod.toUpperCase())}</span></div>`
    : "";

  const cashChangeLines =
    kind === "receipt" && typeof source.cashReceived === "number"
      ? `<div class="kv"><span>Cash received</span><span>${formatCurrency(source.cashReceived)}</span></div>
         ${typeof source.change === "number" ? `<div class="kv"><span>Change</span><span>${formatCurrency(source.change)}</span></div>` : ""}`
      : "";

  const warrantyNote = settings && typeof settings.warrantyNote === "string" && settings.warrantyNote.trim()
    ? `<div class="footnote"><strong>WARRANTY:</strong> ${escHtml(settings.warrantyNote.trim())}</div>`
    : "";
  const footerNote = settings && typeof settings.receiptFooter === "string" && settings.receiptFooter.trim()
    ? `<div class="footnote">${escHtml(settings.receiptFooter.trim())}</div>`
    : "";
  const preOrderNote = hasPreOrder
    ? `<div class="footnote"><strong>PRE-ORDER:</strong> Items marked PRE-ORDER will be delivered once available. Stock is not deducted until fulfilment.</div>`
    : "";

  const device = [source.phoneBrand, source.phoneModel].filter(Boolean).join(" ") || "—";

  const trackingBlock =
    kind === "receipt" && trackingQr
      ? `<div class="tracking">
           <img src="${trackingQr.dataUrl}" alt="Repair tracking QR code"/>
           <div>
             <div class="tracking-label">SCAN TO TRACK YOUR REPAIR</div>
             <div class="tracking-copy">Get live status updates on your phone.</div>
             <div class="tracking-url">${escHtml(trackingQr.url)}</div>
           </div>
         </div>`
      : "";

  return `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8"/>
    <title>${brandName} — ${docTitle} ${escHtml(source.jobNumber || "")}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #111; margin: 0; padding: 16px; background: #fff; }
      .sheet { max-width: 420px; margin: 0 auto; }
      .header { text-align: center; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 12px; }
      .header h1 { font-size: 17px; margin: 0 0 2px; letter-spacing: 0.5px; }
      .header .brandline { font-size: 11px; color: #444; line-height: 1.5; }
      .doctitle { text-align: center; font-size: 13px; font-weight: bold; letter-spacing: 2px; margin: 4px 0 8px; }
      .badge { display: inline-block; border: 1px solid #111; padding: 1px 8px; font-size: 11px; font-weight: bold; letter-spacing: 1px; }
      .meta { margin-bottom: 10px; }
      .kv { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; padding: 2px 0; }
      .kv.section { border-top: 1px dashed #aaa; margin-top: 4px; padding-top: 4px; }
      table.items { width: 100%; border-collapse: collapse; margin: 8px 0; }
      table.items th { border-top: 1px solid #111; border-bottom: 1px solid #111; padding: 4px 6px; font-size: 11px; text-align: left; }
      table.items td { padding: 4px 6px; font-size: 12px; border-bottom: 1px solid #eee; vertical-align: top; }
      .totals { width: 100%; font-size: 12px; }
      .totals .grand { border-top: 2px solid #111; font-size: 14px; font-weight: bold; }
      .tag { display: inline-block; font-size: 9px; font-weight: bold; letter-spacing: 0.5px; border: 1px solid #888; border-radius: 3px; padding: 0 4px; margin-left: 4px; vertical-align: middle; }
      .footnote { margin-top: 8px; padding-top: 6px; border-top: 1px dashed #aaa; font-size: 10px; color: #333; line-height: 1.5; }
      .signoff { margin-top: 14px; display: flex; justify-content: space-between; font-size: 11px; color: #333; }
      .signoff .sig { border-top: 1px solid #111; padding-top: 2px; }
      .tracking { display: flex; align-items: center; gap: 10px; margin: 12px 0 4px; padding: 8px; border: 1px dashed #111; border-radius: 6px; break-inside: avoid; }
      .tracking img { width: 96px; height: 96px; flex: 0 0 96px; image-rendering: pixelated; }
      .tracking-label { font-size: 11px; font-weight: bold; letter-spacing: 0.5px; }
      .tracking-copy { margin-top: 3px; font-size: 10px; color: #444; line-height: 1.4; }
      .tracking-url { margin-top: 4px; font-size: 10px; line-height: 1.4; color: #111; word-break: break-all; }
      @media print { body { padding: 0; } .btn { display: none !important; } }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div class="header">
        ${logoHtml}
        <h1>${brandName}</h1>
        ${contactLines ? `<div class="brandline">${contactLines}</div>` : ""}
      </div>
      <div class="doctitle">${docTitle}</div>

      <div class="meta">
        <div class="kv"><span><strong>Status</strong></span><span><strong class="badge">${escHtml(statusLabel(source.status))}</strong></span></div>
        <div class="kv">${escHtml(kind === "receipt" ? "Date issued" : "Date")}<span>${formatDateForPrint(source.createdAt)}</span></div>
        ${kind === "receipt" && source.completedAt ? `<div class="kv">Completed<span>${formatDateForPrint(source.completedAt)}</span></div>` : ""}
        <div class="kv">Job #<span class="jobno">${escHtml(source.jobNumber || "—")}</span></div>
        <div class="kv">Payment<span>${escHtml(paymentStatus)}${source.paymentMethod ? ` · ${escHtml(source.paymentMethod.toUpperCase())}` : ""}</span></div>
      </div>

      <div class="meta">
        <div class="kv"><span>Customer</span><span>${escHtml(source.customerName || "Walk-in")}${source.customerPhone ? ` · ${escHtml(source.customerPhone)}` : ""}</span></div>
        ${source.customerEmail ? `<div class="kv">Email<span>${escHtml(source.customerEmail)}</span></div>` : ""}
        <div class="kv">Device<span>${escHtml(device)}</span></div>
        ${kind === "slip" && source.devicePasscode ? `<div class="kv">Passcode<span>${escHtml(source.devicePasscode)}</span></div>` : ""}
        <div class="kv">Technician<span>${escHtml(source.technicianName || "Not assigned")}</span></div>
      </div>

      <table class="items">
        <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th align="right">Amount</th></tr></thead>
        <tbody>${itemRows || `<tr><td colspan="4" style="color:#888;">No items</td></tr>`}</tbody>
      </table>

      <div class="totals">
        <div class="kv">Subtotal<span>${formatCurrency(subtotal)}</span></div>
        <div class="kv">Discount<span>${formatCurrency(discount)}</span></div>
        <div class="kv grand">Total<span>${formatCurrency(total)}</span></div>
        <div class="kv">Amount paid<span>${formatCurrency(amountPaid)}</span></div>
        <div class="kv">Remaining balance<span>${formatCurrency(remainingBalance)}</span></div>
        ${methodLine}
        ${cashChangeLines}
      </div>

      ${trackingBlock}
      ${preOrderNote}
      ${warrantyNote}
      ${footerNote}

      <div class="signoff">
        <div>Prepared by<br/><span class="sig">${escHtml(source.technicianName || "____________________")}</span></div>
        <div>Customer signature<br/><span class="sig">____________________</span></div>
      </div>

      <script>window.onload = function () { window.print(); };</script>
    </div>
  </body>
  </html>`;
}

/** Open the print popup synchronously so browser popup blockers allow it. */
function openPrintWindow(): Window | null {
  const win = window.open("", "_blank");
  if (!win) {
    window.alert("Pop-ups are blocked. Please allow pop-ups for this site to print.");
    return null;
  }
  return win;
}

function writePrintWindow(win: Window, html: string): void {
  win.document.write(html);
  win.document.close();
  win.focus();
}

/** Open a popup with the given HTML and trigger the browser print dialog. */
export function printDocument(html: string): void {
  const win = openPrintWindow();
  if (!win) return;
  writePrintWindow(win, html);
}

/**
 * Print a completed-payment receipt. The popup is opened before the QR code is
 * generated so browsers still treat it as part of the user's click.
 */
export async function printReceipt(
  shop: ShopProfile,
  settings: Record<string, any> | null | undefined,
  source: PrintSource,
): Promise<void> {
  const win = openPrintWindow();
  if (!win) return;

  let trackingQr: TrackingQr | undefined;
  const url = trackingPageUrl(source.trackingToken);
  if (url && isSupabaseConfigured()) {
    try {
      trackingQr = {
        url,
        dataUrl: await QRCode.toDataURL(url, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 192,
        }),
      };
    } catch (error) {
      console.warn("[printing] Could not generate tracking QR code:", error);
    }
  }

  if (win.closed) return;
  writePrintWindow(win, buildPrintHtml(shop, settings, "receipt", source, trackingQr));
}

/** Print a job slip for an open/pending job (deposit-based). */
export function printJobSlip(
  shop: ShopProfile,
  settings: Record<string, any> | null | undefined,
  source: PrintSource,
): void {
  printDocument(buildPrintHtml(shop, settings, "slip", source));
}