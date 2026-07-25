import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { getDb } from "./queries/connection.js";
import { users, type User } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { verifyAuthToken } from "./auth-utils.js";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  /** Present when a valid `Authorization: Bearer <jwt>` was supplied */
  user?: User;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };

  const header = opts.req.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const payload = verifyAuthToken(header.slice(7).trim());
    if (payload) {
      try {
        const user = await getDb().query.users.findFirst({
          where: eq(users.id, payload.sub),
        });
        if (user) ctx.user = user;
      } catch (err) {
        console.error("[auth] failed to load user from token:", err);
      }
    }
  }

  return ctx;
}
