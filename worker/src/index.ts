import { DASHBOARD_HTML } from "./dashboard";

export interface Env {
  DB: D1Database;
  API_KEY: string;
}

// 1x1 transparent GIF
const PIXEL = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (c) => c.charCodeAt(0),
);

// Ignore pixel loads this soon after sending (Gmail rendering the sender's own copy).
const GRACE_MS = 10_000;

const PIXEL_PATH = /^\/p\/([0-9a-f-]{36})\.gif$/i;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function authorized(req: Request, env: Env): boolean {
  const header = req.headers.get("Authorization") ?? "";
  return !!env.API_KEY && header === `Bearer ${env.API_KEY}`;
}

async function recordOpen(env: Env, id: string, userAgent: string): Promise<void> {
  const email = await env.DB.prepare("SELECT sent_at FROM emails WHERE id = ?")
    .bind(id)
    .first<{ sent_at: number }>();
  const now = Date.now();
  if (!email || now - email.sent_at < GRACE_MS) return;
  await env.DB.prepare("INSERT INTO opens (email_id, opened_at, user_agent) VALUES (?, ?, ?)")
    .bind(id, now, userAgent.slice(0, 300))
    .run();
}

async function listEmails(env: Env, limit: number) {
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.recipients, e.subject, e.sent_at,
            COUNT(o.id) AS open_count,
            MIN(o.opened_at) AS first_open,
            MAX(o.opened_at) AS last_open
       FROM emails e
       LEFT JOIN opens o ON o.email_id = e.id
      GROUP BY e.id
      ORDER BY e.sent_at DESC
      LIMIT ?`,
  )
    .bind(limit)
    .all();
  return results;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;

    const pixel = pathname.match(PIXEL_PATH);
    if (pixel && req.method === "GET") {
      ctx.waitUntil(recordOpen(env, pixel[1].toLowerCase(), req.headers.get("User-Agent") ?? ""));
      return new Response(PIXEL, {
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
    }

    if (pathname === "/" && req.method === "GET") {
      return new Response(DASHBOARD_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (pathname.startsWith("/api/")) {
      if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
      if (!authorized(req, env)) return json({ error: "unauthorized" }, 401);

      if (pathname === "/api/track" && req.method === "POST") {
        const body = (await req.json().catch(() => null)) as {
          id?: string;
          recipients?: string[] | string;
          subject?: string;
        } | null;
        const id = body?.id?.toLowerCase();
        if (!id || !/^[0-9a-f-]{36}$/.test(id)) return json({ error: "invalid id" }, 400);
        const recipients = Array.isArray(body?.recipients)
          ? body.recipients.join(", ")
          : (body?.recipients ?? "");
        await env.DB.prepare(
          "INSERT OR IGNORE INTO emails (id, recipients, subject, sent_at) VALUES (?, ?, ?, ?)",
        )
          .bind(id, recipients.slice(0, 1000), (body?.subject ?? "").slice(0, 500), Date.now())
          .run();
        return json({ ok: true });
      }

      if (pathname === "/api/emails" && req.method === "GET") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 500);
        return json(await listEmails(env, limit));
      }

      const del = pathname.match(/^\/api\/emails\/([0-9a-f-]{36})$/i);
      if (del && req.method === "DELETE") {
        const id = del[1].toLowerCase();
        await env.DB.batch([
          env.DB.prepare("DELETE FROM opens WHERE email_id = ?").bind(id),
          env.DB.prepare("DELETE FROM emails WHERE id = ?").bind(id),
        ]);
        return json({ ok: true });
      }

      return json({ error: "not found" }, 404);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
