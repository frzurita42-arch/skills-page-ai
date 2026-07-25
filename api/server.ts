import { getRequestListener } from "@hono/node-server";
import app from "./app";

/**
 * Vercel serverless entry. Vercel's Node runtime invokes the default export
 * with Node's (IncomingMessage, ServerResponse) — NOT a Web Request — so we use
 * @hono/node-server's request listener to adapt Node req/res to Hono's fetch
 * handler. (hono/vercel's `handle` is for the Edge/Next.js runtime and would be
 * handed an IncomingMessage here, crashing with FUNCTION_INVOCATION_FAILED.)
 *
 * vercel.json rewrites every /api/* request here; the function receives the
 * original URL, so /api/trpc/* still reaches the tRPC handler. Vercel serves the
 * built SPA (dist/public) directly, so this only handles the API.
 */
export default getRequestListener(app.fetch);
