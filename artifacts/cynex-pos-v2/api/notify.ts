import { handleNotifyRequest } from '../server/notifications/http';

/**
 * Vercel Function: /api/notify
 *
 * GET  -> configuration health (used by Settings)
 * POST -> validate + send one customer email through Resend
 *
 * All Resend credentials live in server environment variables. Nothing under
 * `server/` is imported by the Vite client bundle.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleNotifyRequest(request);
  },
};
