import { handle } from "hono/vercel";
import app from "./app";

/**
 * Vercel serverless entry. `vercel.json` rewrites every `/api/*` request to
 * this function; Hono then routes it (the function receives the original URL,
 * so `/api/trpc/*` still reaches the tRPC handler). Vercel serves the built SPA
 * (dist/public) directly, so this function only handles the API.
 */
export default handle(app);
