/**
 * Vite development adapter for `/api/notify`.
 *
 * Vercel runs `api/notify.ts` directly in production. This adapter lets the
 * Settings test button work during `pnpm dev` with the server-only keys from
 * the local `.env` file (Vite never exposes process.env to the browser).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleNotifyRequest } from './http';

type NextFunction = (error?: unknown) => void;

function toHeaders(source: IncomingMessage['headers']): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) headers.set(key, value.join(', '));
    else if (typeof value === 'string') headers.set(key, value);
  }
  return headers;
}

export async function notifyDevMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
  next: NextFunction,
): Promise<void> {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname !== '/api/notify') {
    next();
    return;
  }

  try {
    let body: Buffer | undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      body = Buffer.concat(chunks);
    }

    const apiRequest = new Request(url, {
      method: request.method || 'GET',
      headers: toHeaders(request.headers),
      ...(body && body.length > 0 ? { body: new Uint8Array(body) } : {}),
    });
    const apiResponse = await handleNotifyRequest(apiRequest);

    response.statusCode = apiResponse.status;
    apiResponse.headers.forEach((value, key) => {
      response.setHeader(key, value);
    });
    const bytes = Buffer.from(await apiResponse.arrayBuffer());
    response.end(bytes);
  } catch (error) {
    console.error('[notify] local API error:', error);
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    response.end(JSON.stringify({ ok: false, error: 'Local notification API failed' }));
  }
}
