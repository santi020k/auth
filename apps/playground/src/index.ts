import { createMultiUserAuth, type MultiUserAuthInstance, normalizeOwnerEmail } from "@santi020k/auth-cloudflare";
import { createHonoAuthHandler } from "@santi020k/auth-hono";
import { type Context, Hono } from "hono";

interface Bindings {
  ALLOW_LOCAL_CODE: string;
  APPLICATION_ORIGIN: string;
  ASSETS: Fetcher;
  AUTH_DB: D1Database;
  AUTH_SERVER_URL: string;
  AUTH_SECRET: string;
  OWNER_EMAIL: string;
}

interface MailboxRow {
  createdAt: number;
  email: string;
  otp: string;
}

const app = new Hono<{ Bindings: Bindings }>();

function isLocalRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === "127.0.0.1" || hostname === "localhost";
}

app.get("/api/dev/latest-code", async (context) => {
  if (context.env.ALLOW_LOCAL_CODE !== "true" || !isLocalRequest(context.req.raw)) return context.notFound();
  const row = await context.env.AUTH_DB.prepare("SELECT email, otp, createdAt FROM playground_mailbox WHERE id = ?")
    .bind("latest")
    .first<MailboxRow>();
  return context.json(row, 200, { "Cache-Control": "no-store" });
});

app.post("/api/dev/revoke-owner", async (context) => {
  if (context.env.ALLOW_LOCAL_CODE !== "true" || !isLocalRequest(context.req.raw)) return context.notFound();
  await context.env.AUTH_DB.prepare(
    `INSERT INTO playground_mailbox (id, email, otp, createdAt) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, otp = excluded.otp, createdAt = excluded.createdAt`,
  )
    .bind("owner-access", normalizeOwnerEmail(context.env.OWNER_EMAIL), "revoked", Date.now())
    .run();
  return context.json({ success: true }, 200, { "Cache-Control": "no-store" });
});

async function authorizePlaygroundEmail(context: Context<{ Bindings: Bindings }>, email: string): Promise<boolean> {
  if (normalizeOwnerEmail(email) !== normalizeOwnerEmail(context.env.OWNER_EMAIL)) return false;
  const revoked = await context.env.AUTH_DB.prepare("SELECT id FROM playground_mailbox WHERE id = ?")
    .bind("owner-access")
    .first<{ id: string }>();
  return revoked === null;
}

app.get("/api/session", async (context) => {
  const auth = createMultiUserAuth({
    appName: "santi020k auth playground",
    authorizeEmail: (email) => authorizePlaygroundEmail(context, email),
    baseURL: context.env.AUTH_SERVER_URL,
    browserOrigin: context.env.APPLICATION_ORIGIN,
    cookiePrefix: "santi-auth-playground",
    database: context.env.AUTH_DB,
    secret: context.env.AUTH_SECRET,
    sendVerificationOTP: () => Promise.resolve(),
    waitUntil: (task) => {
      context.executionCtx.waitUntil(task);
    },
  });
  return context.json(await auth.resolveSession(context.req.raw.headers), 200, { "Cache-Control": "no-store" });
});

function createPlaygroundAuth(context: Context<{ Bindings: Bindings }>): MultiUserAuthInstance {
  return createMultiUserAuth({
    appName: "santi020k auth playground",
    authorizeEmail: (email) => authorizePlaygroundEmail(context, email),
    baseURL: context.env.AUTH_SERVER_URL,
    browserOrigin: context.env.APPLICATION_ORIGIN,
    cookiePrefix: "santi-auth-playground",
    database: context.env.AUTH_DB,
    secret: context.env.AUTH_SECRET,
    sendVerificationOTP: async ({ email, otp }) => {
      if (context.env.ALLOW_LOCAL_CODE !== "true" || !isLocalRequest(context.req.raw)) {
        throw new Error("playground_email_delivery_not_configured");
      }
      await context.env.AUTH_DB.prepare(
        `INSERT INTO playground_mailbox (id, email, otp, createdAt) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET email = excluded.email, otp = excluded.otp, createdAt = excluded.createdAt`,
      )
        .bind("latest", normalizeOwnerEmail(email), otp, Date.now())
        .run();
    },
    waitUntil: (task) => {
      context.executionCtx.waitUntil(task);
    },
  });
}

const authHandler = createHonoAuthHandler<{ Bindings: Bindings }>(createPlaygroundAuth);
app.all("/api/auth/*", authHandler);

app.all("*", (context) => context.env.ASSETS.fetch(context.req.raw));

export default app;
